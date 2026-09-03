"""
The six domain experts that vote on every market action.

Each owns one dimension the problem statement names — signal, information,
volatility, exposure, execution cost, and correlation — so that no single
factor can carry a decision on its own. Each runs its own quantitative pass
and escalates to the LLM only where the numbers leave a judgement call.
"""
import math
from typing import Optional

from app.agents.market.base import MarketAgent
from app.config import get_settings
from app.llm.market_prompts import (
    CORRELATION_AGENT_PROMPT,
    EXPOSURE_AGENT_PROMPT,
    LIQUIDITY_AGENT_PROMPT,
    SENTIMENT_AGENT_PROMPT,
    SIGNAL_AGENT_PROMPT,
    VOLATILITY_AGENT_PROMPT,
)
from app.market.indicators import estimate_slippage_bps

settings = get_settings()


def _stale_verdict(agent: str, obs: dict) -> Optional[dict]:
    """
    Shared freshness gate.

    Time-sensitivity is a first-class constraint: a reading older than the
    threshold describes a market that may no longer exist, so no agent is
    permitted to act on it.
    """
    age = obs.get("age_seconds", 0.0)
    if age > settings.MARKET_STALENESS_SECONDS:
        return {
            "agent_name": agent,
            "decision": "deny",
            "confidence": 0.95,
            "reasoning": (
                f"Observation is {age:.1f}s old against a "
                f"{settings.MARKET_STALENESS_SECONDS:.1f}s staleness threshold. "
                f"This reading may no longer represent prevailing conditions, so it "
                f"cannot justify an action."
            ),
            "risk_flags": ["stale_observation"],
        }
    return None


# --------------------------------------------------------------------- #
# 1. Signal
# --------------------------------------------------------------------- #

class SignalAgent(MarketAgent):
    """Directional edge from price action."""

    # Momentum below this is indistinguishable from noise.
    NOISE_FLOOR = 0.0005

    def __init__(self):
        super().__init__("signal", SIGNAL_AGENT_PROMPT, weight=0.20)

    def quantitative_evaluate(self, proposal: dict) -> Optional[dict]:
        obs = proposal.get("observation", {})
        stale = _stale_verdict(self.name, obs)
        if stale and proposal.get("action") != "close":
            return stale

        short = obs.get("momentum_short", 0.0)
        long = obs.get("momentum_long", 0.0)
        side = proposal.get("side", "long")
        direction = 1 if side == "long" else -1

        # On a close, `side` is the direction being exited. The question is
        # whether the price thesis that justified the position still holds, so
        # the vote runs the other way: momentum turning against the position is
        # a reason to approve the exit, not to deny it.
        if proposal.get("action") == "close":
            held_alignment = (0.7 * short + 0.3 * long) * direction
            if held_alignment < -self.NOISE_FLOOR:
                return {
                    "agent_name": self.name,
                    "decision": "approve",
                    "confidence": min(0.9, 0.6 + abs(held_alignment) * 25),
                    "reasoning": (
                        f"Momentum has turned against the {side} position "
                        f"({short:+.3%} short, {long:+.3%} long). The thesis that "
                        f"justified holding no longer holds; exiting is warranted."
                    ),
                    "risk_flags": ["thesis_invalidated"],
                }
            if held_alignment > 4 * self.NOISE_FLOOR:
                return {
                    "agent_name": self.name,
                    "decision": "deny",
                    "confidence": 0.8,
                    "reasoning": (
                        f"Momentum still favours the {side} position "
                        f"({short:+.3%} short, {long:+.3%} long). Closing here "
                        f"abandons a thesis that is still working."
                    ),
                    "risk_flags": [],
                }
            # Marginal: let the model judge whether the move is a pause or a turn.
            return None

        # No measurable move in either horizon: nothing to trade.
        if abs(short) < self.NOISE_FLOOR and abs(long) < self.NOISE_FLOOR:
            return {
                "agent_name": self.name,
                "decision": "deny",
                "confidence": 0.75,
                "reasoning": (
                    f"Momentum is flat on both horizons "
                    f"({short:+.3%} short, {long:+.3%} long), below the "
                    f"{self.NOISE_FLOOR:.2%} noise floor. No directional edge to act on."
                ),
                "risk_flags": ["no_signal"],
            }

        aligned_short = short * direction > 0
        aligned_long = long * direction > 0

        # Both horizons run against the proposal: unambiguous.
        if not aligned_short and not aligned_long:
            return {
                "agent_name": self.name,
                "decision": "deny",
                "confidence": 0.85,
                "reasoning": (
                    f"Both horizons oppose a {side} position "
                    f"({short:+.3%} short, {long:+.3%} long). "
                    f"Entering here fights the prevailing move."
                ),
                "risk_flags": ["signal_contradiction"],
            }

        # Both agree and the short leg is decisive: also unambiguous.
        if aligned_short and aligned_long and abs(short) > 4 * self.NOISE_FLOOR:
            confidence = min(0.92, 0.6 + abs(short) * 25)
            return {
                "agent_name": self.name,
                "decision": "approve",
                "confidence": round(confidence, 3),
                "reasoning": (
                    f"Momentum confirms {side} on both horizons "
                    f"({short:+.3%} short, {long:+.3%} long), with the short leg "
                    f"well clear of noise."
                ),
                "risk_flags": [],
            }

        # Horizons disagree, or the move is marginal. This is the judgement
        # call — continuation or exhaustion — so hand it to the model.
        return None

    def build_user_prompt(self, proposal: dict) -> str:
        obs = proposal.get("observation", {})
        return (
            f"{self.format_proposal(proposal)}\n\n"
            f"SIGNAL DETAIL\n"
            f"- Short-horizon return: {obs.get('momentum_short', 0):+.4%}\n"
            f"- Long-horizon return: {obs.get('momentum_long', 0):+.4%}\n"
            f"- Per-tick sigma: {obs.get('sigma', 0):.6f}\n"
            f"- Short move in sigma units: "
            f"{_in_sigmas(obs.get('momentum_short', 0), obs.get('sigma', 0)):.2f}\n\n"
            f"The horizons disagree or the move is marginal. Is this continuation "
            f"worth entering, or exhaustion to stand aside from?"
        )


# --------------------------------------------------------------------- #
# 2. Sentiment
# --------------------------------------------------------------------- #

class SentimentAgent(MarketAgent):
    """Whether the information environment supports the action."""

    STRONG = 0.5

    def __init__(self):
        super().__init__("sentiment", SENTIMENT_AGENT_PROMPT, weight=0.12)

    def quantitative_evaluate(self, proposal: dict) -> Optional[dict]:
        obs = proposal.get("observation", {})
        stale = _stale_verdict(self.name, obs)
        if stale and proposal.get("action") != "close":
            return stale

        sentiment = obs.get("news_sentiment")

        # On a close, adverse news is a reason to exit rather than a reason to
        # stay out. Absent coverage says nothing either way.
        if proposal.get("action") == "close":
            if sentiment is None:
                return {
                    "agent_name": self.name,
                    "decision": "review",
                    "confidence": 0.25,
                    "reasoning": (
                        "No news coverage bearing on this instrument, so the "
                        "information environment offers no view on exiting."
                    ),
                    "risk_flags": ["no_news_coverage"],
                }
            held_direction = 1 if proposal.get("side", "long") == "long" else -1
            if sentiment * held_direction <= -self.STRONG:
                return {
                    "agent_name": self.name,
                    "decision": "approve",
                    "confidence": min(0.88, 0.6 + abs(sentiment) * 0.3),
                    "reasoning": (
                        f"News sentiment of {sentiment:+.2f} runs against the held "
                        f"{proposal.get('side')} position. Exiting is supported. "
                        f"Headline: {obs.get('news_headline') or 'n/a'}"
                    ),
                    "risk_flags": ["adverse_news"],
                }
            return None

        # No coverage is genuinely neutral. Say so honestly at low confidence
        # rather than manufacturing a view.
        if sentiment is None:
            return {
                "agent_name": self.name,
                "decision": "review",
                "confidence": 0.35,
                "reasoning": (
                    "No news coverage attached to this instrument in the current "
                    "window. Sentiment is unknown rather than neutral, so this vote "
                    "carries little weight."
                ),
                "risk_flags": ["no_news_coverage"],
            }

        direction = 1 if proposal.get("side", "long") == "long" else -1
        aligned = sentiment * direction

        if aligned <= -self.STRONG:
            return {
                "agent_name": self.name,
                "decision": "deny",
                "confidence": min(0.9, 0.6 + abs(aligned) * 0.3),
                "reasoning": (
                    f"News sentiment of {sentiment:+.2f} runs strongly against the "
                    f"proposed {proposal.get('side')} position. "
                    f"Headline: {obs.get('news_headline') or 'n/a'}"
                ),
                "risk_flags": ["adverse_news"],
            }

        # Everything between strongly-against and strongly-for is a judgement
        # call about whether the news is already priced in.
        return None

    def build_user_prompt(self, proposal: dict) -> str:
        obs = proposal.get("observation", {})
        return (
            f"{self.format_proposal(proposal)}\n\n"
            f"INFORMATION DETAIL\n"
            f"- Sentiment score: {obs.get('news_sentiment')}\n"
            f"- Headline: {obs.get('news_headline') or 'none'}\n"
            f"- Price already moved (short horizon): "
            f"{obs.get('momentum_short', 0):+.3%}\n\n"
            f"Does this information support the proposed side, or is it already "
            f"reflected in the price?"
        )


# --------------------------------------------------------------------- #
# 3. Volatility
# --------------------------------------------------------------------- #

class VolatilityAgent(MarketAgent):
    """Downside survivability under current volatility."""

    def __init__(self):
        super().__init__("volatility", VOLATILITY_AGENT_PROMPT, weight=0.20)

    def quantitative_evaluate(self, proposal: dict) -> Optional[dict]:
        obs = proposal.get("observation", {})
        pf = proposal.get("portfolio", {})

        # Closing reduces risk. This agent exists to stop the desk taking on
        # more than it can survive, so it never stands in the way of an exit —
        # and when the desk is deep in drawdown it actively favours one.
        if proposal.get("action") == "close":
            drawdown = pf.get("drawdown_pct", 0.0)
            max_dd = pf.get("max_drawdown_pct", settings.MAX_DRAWDOWN_PCT)
            if max_dd and drawdown >= max_dd * 0.7:
                return {
                    "agent_name": self.name,
                    "decision": "approve",
                    "confidence": 0.9,
                    "reasoning": (
                        f"Drawdown of {drawdown:.2%} is approaching the {max_dd:.0%} "
                        f"halt threshold. Reducing exposure is the risk-appropriate "
                        f"action."
                    ),
                    "risk_flags": ["drawdown_pressure"],
                }
            return {
                "agent_name": self.name,
                "decision": "approve",
                "confidence": 0.7,
                "reasoning": (
                    f"Closing reduces exposure at {obs.get('volatility', 0):.1%} "
                    f"annualised volatility. No risk objection to exiting."
                ),
                "risk_flags": [],
            }

        stale = _stale_verdict(self.name, obs)
        if stale:
            return stale

        drawdown = pf.get("drawdown_pct", 0.0)
        max_dd = pf.get("max_drawdown_pct", settings.MAX_DRAWDOWN_PCT)

        # Already halted or past the limit: nothing may be opened.
        if drawdown >= max_dd and proposal.get("action") == "open":
            return {
                "agent_name": self.name,
                "decision": "deny",
                "confidence": 0.99,
                "reasoning": (
                    f"Portfolio drawdown of {drawdown:.2%} is at or beyond the "
                    f"{max_dd:.0%} halt threshold. No new risk may be added."
                ),
                "risk_flags": ["drawdown_limit_breached"],
            }

        vol = obs.get("volatility", 0.0)
        nav = pf.get("nav", 0.0) or 1.0
        notional = proposal.get("proposed_notional", 0.0)

        # A plausible one-day adverse move, expressed against NAV.
        daily_vol = vol / math.sqrt(365) if vol > 0 else 0.0
        adverse_move = 2 * daily_vol  # ~2 sd
        position_loss_pct = (notional * adverse_move) / nav

        # A single position that could burn most of the remaining drawdown
        # budget in one session is not survivable.
        remaining_budget = max(max_dd - drawdown, 0.0)
        if remaining_budget > 0 and position_loss_pct > remaining_budget * 0.75:
            return {
                "agent_name": self.name,
                "decision": "deny",
                "confidence": 0.88,
                "reasoning": (
                    f"At {vol:.1%} annualised volatility a 2-sigma adverse day costs "
                    f"{position_loss_pct:.2%} of NAV, against only "
                    f"{remaining_budget:.2%} of drawdown budget remaining. "
                    f"The position is not survivable at this size."
                ),
                "risk_flags": ["volatility_exceeds_budget"],
            }

        # Volatility is measurable and comfortably inside target: clear approve.
        if 0 < vol <= settings.TARGET_VOL and position_loss_pct < remaining_budget * 0.25:
            return {
                "agent_name": self.name,
                "decision": "approve",
                "confidence": 0.82,
                "reasoning": (
                    f"Realised volatility of {vol:.1%} is within the "
                    f"{settings.TARGET_VOL:.0%} target. A 2-sigma adverse day costs "
                    f"{position_loss_pct:.2%} of NAV against {remaining_budget:.2%} "
                    f"of budget remaining."
                ),
                "risk_flags": [],
            }

        # Volatility unmeasured, or elevated but not disqualifying: judgement.
        return None

    def build_user_prompt(self, proposal: dict) -> str:
        obs = proposal.get("observation", {})
        pf = proposal.get("portfolio", {})
        vol = obs.get("volatility", 0.0)
        return (
            f"{self.format_proposal(proposal)}\n\n"
            f"RISK DETAIL\n"
            f"- Annualised volatility: {vol:.2%} "
            f"(desk target {settings.TARGET_VOL:.0%})\n"
            f"- Implied daily volatility: {vol / math.sqrt(365):.3%}\n"
            f"- Samples behind the estimate: "
            f"{'insufficient' if vol == 0 else 'sufficient'}\n"
            f"- Drawdown used: {pf.get('drawdown_pct', 0):.2%} of "
            f"{pf.get('max_drawdown_pct', 0):.0%} limit\n\n"
            f"Is this position survivable under current volatility?"
        )


# --------------------------------------------------------------------- #
# 4. Exposure
# --------------------------------------------------------------------- #

class ExposureAgent(MarketAgent):
    """Literal enforcement of the human-defined capital limits."""

    def __init__(self):
        super().__init__("exposure", EXPOSURE_AGENT_PROMPT, weight=0.20)

    def quantitative_evaluate(self, proposal: dict) -> Optional[dict]:
        # Closing risk is always permitted — limits restrict adding exposure,
        # never reducing it.
        if proposal.get("action") == "close":
            return {
                "agent_name": self.name,
                "decision": "approve",
                "confidence": 0.95,
                "reasoning": "Closing reduces gross exposure; no capital limit restricts it.",
                "risk_flags": [],
            }

        pf = proposal.get("portfolio", {})
        nav = pf.get("nav", 0.0) or 1.0
        cash = pf.get("cash", 0.0)
        notional = proposal.get("proposed_notional", 0.0)

        max_exposure = pf.get("max_exposure_pct", settings.MAX_EXPOSURE_PCT)
        max_position = pf.get("max_position_pct", settings.MAX_POSITION_PCT)
        current_exposure = pf.get("exposure_pct", 0.0)

        if pf.get("halted"):
            return _limit_breach(
                self.name,
                f"The desk is halted: {pf.get('halt_reason') or 'reason unrecorded'}. "
                f"No new exposure may be opened.",
                "desk_halted",
            )

        if notional > cash:
            return _limit_breach(
                self.name,
                f"Proposed notional of ${notional:,.2f} exceeds available cash of "
                f"${cash:,.2f}. The capital does not exist.",
                "insufficient_cash",
            )

        position_pct = notional / nav
        if position_pct > max_position:
            return _limit_breach(
                self.name,
                f"Position would be {position_pct:.2%} of NAV against a "
                f"{max_position:.0%} single-position ceiling.",
                "position_limit_breach",
            )

        projected = current_exposure + position_pct
        if projected > max_exposure:
            return _limit_breach(
                self.name,
                f"Gross exposure would rise to {projected:.2%} against a "
                f"{max_exposure:.0%} ceiling.",
                "exposure_limit_breach",
            )

        # Inside every limit, but with little headroom: approve, flag tightness,
        # and let the reduced confidence show in the consensus.
        headroom = max_exposure - projected
        if headroom < 0.05:
            return {
                "agent_name": self.name,
                "decision": "approve",
                "confidence": 0.55,
                "reasoning": (
                    f"Within limits at {projected:.2%} gross exposure, but only "
                    f"{headroom:.2%} of headroom remains below the {max_exposure:.0%} "
                    f"ceiling. Little room for a further opportunity."
                ),
                "risk_flags": ["exposure_headroom_low"],
            }

        return {
            "agent_name": self.name,
            "decision": "approve",
            "confidence": 0.9,
            "reasoning": (
                f"Within all capital limits: position {position_pct:.2%} of NAV "
                f"(ceiling {max_position:.0%}), gross exposure {projected:.2%} "
                f"(ceiling {max_exposure:.0%}), cash ${cash:,.2f} sufficient."
            ),
            "risk_flags": [],
        }

    def build_user_prompt(self, proposal: dict) -> str:
        # Limits are arithmetic; the quantitative pass is always decisive.
        return self.format_proposal(proposal)


def _limit_breach(agent: str, reasoning: str, flag: str) -> dict:
    return {
        "agent_name": agent,
        "decision": "deny",
        "confidence": 0.99,
        "reasoning": reasoning,
        "risk_flags": [flag, "mandate_breach"],
    }


# --------------------------------------------------------------------- #
# 5. Liquidity and execution cost
# --------------------------------------------------------------------- #

class LiquidityAgent(MarketAgent):
    """Whether the edge survives the cost of capturing it."""

    def __init__(self):
        super().__init__("liquidity", LIQUIDITY_AGENT_PROMPT, weight=0.16)

    # A close whose exit cost exceeds this is worth flagging, but never worth
    # blocking outright — being unable to exit is a worse outcome than paying.
    EXPENSIVE_EXIT_BPS = 50.0

    def quantitative_evaluate(self, proposal: dict) -> Optional[dict]:
        obs = proposal.get("observation", {})
        notional = proposal.get("proposed_notional", 0.0)
        depth = obs.get("depth_quote", 0.0)
        spread_bps = obs.get("spread_bps", 0.0)

        # A close carries no expected edge by construction, so edge is the wrong
        # test. The only question is whether the exit is executable and at what
        # cost. This agent must never be the reason a position cannot be closed.
        if proposal.get("action") == "close":
            exit_cost_bps = estimate_slippage_bps(notional, depth, spread_bps) + settings.FEE_BPS
            expensive = exit_cost_bps > self.EXPENSIVE_EXIT_BPS
            return {
                "agent_name": self.name,
                "decision": "approve",
                "confidence": 0.55 if expensive else 0.85,
                "reasoning": (
                    f"Exit costs {exit_cost_bps:.1f} bps against {spread_bps:.1f} bps "
                    f"of spread and ${depth:,.0f} of visible depth."
                    + (
                        " That is expensive; the exit is still executable and "
                        "blocking it would be worse than paying."
                        if expensive
                        else " The exit is cheap to execute."
                    )
                ),
                "risk_flags": ["expensive_exit"] if expensive else [],
            }

        stale = _stale_verdict(self.name, obs)
        if stale:
            return stale

        edge_bps = proposal.get("expected_edge_bps", 0.0)
        slippage_bps = estimate_slippage_bps(notional, depth, spread_bps)
        total_cost_bps = slippage_bps + settings.FEE_BPS
        net_edge_bps = edge_bps - total_cost_bps

        if edge_bps <= 0:
            return {
                "agent_name": self.name,
                "decision": "deny",
                "confidence": 0.9,
                "reasoning": (
                    f"No positive expected edge was estimated for this action, so "
                    f"{total_cost_bps:.1f} bps of execution cost cannot be justified."
                ),
                "risk_flags": ["no_edge"],
            }

        if net_edge_bps < settings.MIN_EDGE_BPS:
            return {
                "agent_name": self.name,
                "decision": "deny",
                "confidence": 0.87,
                "reasoning": (
                    f"Execution cost of {total_cost_bps:.1f} bps "
                    f"({slippage_bps:.1f} slippage + {settings.FEE_BPS:.1f} fee) leaves "
                    f"only {net_edge_bps:.1f} bps of the {edge_bps:.1f} bps edge, below "
                    f"the {settings.MIN_EDGE_BPS:.0f} bps minimum. Real on paper, "
                    f"unprofitable in practice."
                ),
                "risk_flags": ["edge_consumed_by_costs"],
            }

        if slippage_bps > edge_bps * settings.MAX_SLIPPAGE_SHARE_OF_EDGE:
            return {
                "agent_name": self.name,
                "decision": "deny",
                "confidence": 0.85,
                "reasoning": (
                    f"Modelled slippage of {slippage_bps:.1f} bps consumes more than "
                    f"{settings.MAX_SLIPPAGE_SHARE_OF_EDGE:.0%} of the {edge_bps:.1f} bps "
                    f"edge. Size is too large for ${depth:,.0f} of visible depth."
                ),
                "risk_flags": ["insufficient_depth"],
            }

        confidence = min(0.92, 0.6 + (net_edge_bps / max(edge_bps, 1e-9)) * 0.3)
        return {
            "agent_name": self.name,
            "decision": "approve",
            "confidence": round(confidence, 3),
            "reasoning": (
                f"Executable: {spread_bps:.1f} bps spread and ${depth:,.0f} depth give "
                f"{slippage_bps:.1f} bps slippage. After {total_cost_bps:.1f} bps of "
                f"total cost, {net_edge_bps:.1f} bps of edge survives."
            ),
            "risk_flags": [],
        }

    def build_user_prompt(self, proposal: dict) -> str:
        return self.format_proposal(proposal)


# --------------------------------------------------------------------- #
# 6. Correlation
# --------------------------------------------------------------------- #

class CorrelationAgent(MarketAgent):
    """Whether the action diversifies risk or concentrates it."""

    HIGH_CORRELATION = 0.7

    def __init__(self):
        super().__init__("correlation", CORRELATION_AGENT_PROMPT, weight=0.12)

    def quantitative_evaluate(self, proposal: dict) -> Optional[dict]:
        if proposal.get("action") == "close":
            return {
                "agent_name": self.name,
                "decision": "approve",
                "confidence": 0.9,
                "reasoning": "Closing cannot increase correlated concentration.",
                "risk_flags": [],
            }

        symbol = proposal.get("symbol")
        side = proposal.get("side", "long")
        correlations = proposal.get("correlations", {}).get(symbol, {})
        open_positions = proposal.get("portfolio", {}).get("positions", [])
        nav = proposal.get("portfolio", {}).get("nav", 0.0) or 1.0
        notional = proposal.get("proposed_notional", 0.0)

        if not open_positions:
            return {
                "agent_name": self.name,
                "decision": "approve",
                "confidence": 0.8,
                "reasoning": (
                    "No open positions, so this action cannot concentrate existing "
                    "exposure."
                ),
                "risk_flags": [],
            }

        # Notional that would move together with this one, same direction.
        correlated_notional = 0.0
        worst_pair = ("", 0.0)
        for pos in open_positions:
            other = pos.get("symbol")
            if other == symbol and pos.get("side") != side:
                continue  # an offsetting leg reduces, not adds
            rho = correlations.get(other, 0.0)
            same_direction = pos.get("side") == side
            effective = rho if same_direction else -rho
            if effective >= self.HIGH_CORRELATION:
                correlated_notional += pos.get("notional", 0.0)
                if effective > worst_pair[1]:
                    worst_pair = (other, effective)

        cluster_pct = (correlated_notional + notional) / nav
        max_position = proposal.get("portfolio", {}).get(
            "max_position_pct", settings.MAX_POSITION_PCT
        )

        # A correlated cluster behaves like one position, so it is held to the
        # single-position ceiling rather than the gross ceiling.
        if correlated_notional > 0 and cluster_pct > max_position * 1.5:
            return {
                "agent_name": self.name,
                "decision": "deny",
                "confidence": 0.86,
                "reasoning": (
                    f"This would extend a correlated cluster to {cluster_pct:.2%} of NAV. "
                    f"{worst_pair[0]} correlates {worst_pair[1]:.2f} with {symbol} in the "
                    f"same direction, so the holdings behave as one bet far above the "
                    f"{max_position:.0%} single-position ceiling."
                ),
                "risk_flags": ["correlated_concentration"],
            }

        if correlated_notional == 0:
            return {
                "agent_name": self.name,
                "decision": "approve",
                "confidence": 0.85,
                "reasoning": (
                    f"No open position correlates above {self.HIGH_CORRELATION:.2f} with "
                    f"{symbol} in this direction; the action adds genuine diversification."
                ),
                "risk_flags": [],
            }

        # Some correlated overlap but below the cluster ceiling: judgement call.
        return None

    def build_user_prompt(self, proposal: dict) -> str:
        symbol = proposal.get("symbol")
        correlations = proposal.get("correlations", {}).get(symbol, {})
        positions = proposal.get("portfolio", {}).get("positions", [])
        rows = "\n".join(
            f"- {p.get('symbol')} {p.get('side')} ${p.get('notional', 0):,.0f} "
            f"(correlation with {symbol}: {correlations.get(p.get('symbol'), 0.0):+.2f})"
            for p in positions
        ) or "- none"
        return (
            f"{self.format_proposal(proposal)}\n\n"
            f"OPEN POSITIONS AND THEIR CORRELATION TO {symbol}\n{rows}\n\n"
            f"There is partial correlated overlap below the cluster ceiling. Does this "
            f"action diversify the book or concentrate it?"
        )


def _in_sigmas(move: float, sigma: float) -> float:
    return move / sigma if sigma > 0 else 0.0
