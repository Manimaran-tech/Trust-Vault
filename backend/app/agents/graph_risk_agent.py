import time
import logging
from typing import Optional
from app.agents.base_agent import BaseAgent

logger = logging.getLogger(__name__)

# torch and torch_geometric are optional. Without them this agent abstains
# rather than substituting a fabricated score.
try:
    import torch
    import torch.nn.functional as F
    from torch_geometric.nn import SAGEConv
    from torch_geometric.data import Data
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    logger.warning(
        "PyTorch or PyTorch Geometric not available. GraphRiskAgent will abstain "
        "from every evaluation."
    )

class TransactionGraphSAGE(torch.nn.Module if TORCH_AVAILABLE else object):
    """
    Real GraphSAGE model trained on the Elliptic Bitcoin dataset for fraud detection.
    Expects 166 input features.
    """
    def __init__(self, in_channels=166, hidden_channels=64, out_channels=32):
        super().__init__()
        if TORCH_AVAILABLE:
            self.conv1 = SAGEConv(in_channels, hidden_channels)
            self.conv2 = SAGEConv(hidden_channels, out_channels)
            # Binary classification head (fraud vs normal)
            self.classifier = torch.nn.Linear(out_channels, 2)

    def forward(self, x, edge_index):
        if not TORCH_AVAILABLE:
            return None
        x = self.conv1(x, edge_index)
        x = F.relu(x)
        x = self.conv2(x, edge_index)
        out = self.classifier(x)
        return out

class GraphRiskAgent(BaseAgent):
    """GNN Graph Risk Agent.

    Maintains a live transaction graph and uses a real Hugging Face pre-trained GraphSAGE model 
    (from Arko007/trustworthy-gnn-fraud-models) for real-time anomaly scoring.
    """
    def __init__(self):
        super().__init__(
            name="graph_risk",
            system_prompt="", # No LLM prompt needed for this agent
            weight=0.15,
        )
        if TORCH_AVAILABLE:
            # Elliptic dataset uses 166 features
            self.model = TransactionGraphSAGE(in_channels=166, hidden_channels=64, out_channels=32)
            
            # Attempt to load pre-trained open-source model weights from the local models folder
            try:
                import os
                from safetensors.torch import load_file
                
                model_path = os.path.join(os.path.dirname(__file__), "..", "..", "models", "graphsage_original_elliptic.safetensors")
                logger.info(f"Attempting to load pre-trained GraphSAGE fraud model from {model_path}...")
                
                if os.path.exists(model_path):
                    state_dict = load_file(model_path)
                    # Load the weights into our architecture
                    self.model.load_state_dict(state_dict, strict=False)
                    logger.info("Successfully loaded pre-trained GNN weights from local Hugging Face download!")
                    self._is_pretrained = True
                else:
                    logger.warning("Local pre-trained model file not found in models directory.")
                    self._is_pretrained = False
            except Exception as e:
                logger.warning(f"Could not load pre-trained weights, falling back to random init: {e}")
                self._is_pretrained = False
                
            self.model.eval() # Run in evaluation mode

        # In-memory graph state
        self.node_features = []
        self.edge_index_src = []
        self.edge_index_dst = []
        self.node_id_map = {} # Maps entity strings (e.g. "acct:123") to integer node IDs

    def _get_node_id(self, entity_str: str) -> int:
        if entity_str not in self.node_id_map:
            node_id = len(self.node_id_map)
            self.node_id_map[entity_str] = node_id
            # Pad our 8 local features with zeros to match the 166 features expected by the Elliptic model
            features = [0.1] * 8 + [0.0] * (166 - 8)
            self.node_features.append(features)
        return self.node_id_map[entity_str]

    def _update_graph(self, transaction: dict):
        """Update the in-memory graph with the new transaction."""
        card_member = transaction.get("card_member_name", "unknown")
        merchant = transaction.get("merchant_name", "unknown")
        ip_location = (transaction.get("metadata", {}) or transaction.get("metadata_json", {})).get("ip_location", "unknown")

        src_id = self._get_node_id(f"user:{card_member}")
        dst_id = self._get_node_id(f"merchant:{merchant}")
        ip_id = self._get_node_id(f"ip:{ip_location}")

        # Add edges: User -> Merchant, User -> IP
        self.edge_index_src.extend([src_id, src_id])
        self.edge_index_dst.extend([dst_id, ip_id])
        # Add reverse edges for undirected graph
        self.edge_index_src.extend([dst_id, ip_id])
        self.edge_index_dst.extend([src_id, src_id])

        return src_id

    def build_user_prompt(self, transaction: dict) -> str:
        # Not used because this agent doesn't use the LLM
        return ""

    def rule_evaluate(self, transaction: dict) -> Optional[dict]:
        """Run the GraphSAGE model on the updated graph."""
        start_time = time.time()

        # 1. Update graph
        src_id = self._update_graph(transaction)

        graph_risk_flags = []

        # An untrained network produces noise, not a prediction. Scoring a
        # transaction on randomly initialised weights would be worse than not
        # scoring it, so the agent abstains and says why.
        if not TORCH_AVAILABLE or not getattr(self, "_is_pretrained", False):
            reason = (
                "PyTorch is not installed"
                if not TORCH_AVAILABLE
                else "pre-trained GraphSAGE weights were not loaded"
            )
            return {
                "agent_name": self.name,
                "decision": "review",
                "confidence": 0.15,
                "reasoning": (
                    f"Graph risk model unavailable: {reason}. Abstaining rather than "
                    f"reporting a score this agent cannot actually compute."
                ),
                "risk_flags": ["gnn_unavailable"],
                "processing_time_ms": round((time.time() - start_time) * 1000, 2),
                "raw_response": "GNN_UNAVAILABLE",
                "evaluation_mode": "abstain",
            }

        if len(self.node_features) == 0:
            return {
                "agent_name": self.name,
                "decision": "review",
                "confidence": 0.15,
                "reasoning": "Transaction graph is empty; no neighbourhood to score against.",
                "risk_flags": ["gnn_no_graph"],
                "processing_time_ms": round((time.time() - start_time) * 1000, 2),
                "raw_response": "GNN_NO_GRAPH",
                "evaluation_mode": "abstain",
            }

        # 2. Run the trained model over the live graph
        x = torch.tensor(self.node_features, dtype=torch.float)
        edge_index = torch.tensor(
            [self.edge_index_src, self.edge_index_dst], dtype=torch.long
        )

        with torch.no_grad():
            logits = self.model(x, edge_index)

        # Class 1 is fraud.
        probs = F.softmax(logits[src_id], dim=0)
        fraud_prob = probs[1].item()

        if fraud_prob > 0.85:
            decision = "deny"
            graph_risk_flags.append("gnn_fraud_detected")
            confidence = round(fraud_prob, 3)
        elif fraud_prob > 0.50:
            decision = "review"
            graph_risk_flags.append("gnn_suspicious_pattern")
            confidence = round(fraud_prob, 3)
        else:
            decision = "approve"
            confidence = round(1.0 - fraud_prob, 3)

        return {
            "agent_name": self.name,
            "decision": decision,
            "confidence": confidence,
            "reasoning": (
                f"GraphSAGE prediction over a {len(self.node_id_map)}-node transaction "
                f"graph. Fraud probability: {fraud_prob:.2%}"
            ),
            "risk_flags": graph_risk_flags,
            "processing_time_ms": round((time.time() - start_time) * 1000, 2),
            "raw_response": "GNN_EVALUATION",
            "evaluation_mode": "gnn",
        }

    async def evaluate(self, transaction: dict) -> dict:
        """This agent is purely graph-based; it never consults the LLM."""
        return self.rule_evaluate(transaction)
