import asyncio
import asyncpg
import json

DATABASE_URL = "postgresql://trustvault:trustvault@localhost:5432/trustvault"

async def analyze_transactions():
    """
    Connects to the TrustVault database and provides an overview of recent flagged transactions.
    This script can be executed by Hermes Agent to analyze the system.
    """
    try:
        conn = await asyncpg.connect(DATABASE_URL)
        
        # Query 1: Get count of all transactions by decision
        decisions = await conn.fetch("SELECT decision, COUNT(*) FROM transactions GROUP BY decision")
        
        # Query 2: Get recent denied or reviewed transactions
        recent_flagged = await conn.fetch(
            "SELECT id, amount, merchant_name, decision, risk_flags FROM transactions WHERE decision IN ('deny', 'review') ORDER BY created_at DESC LIMIT 5"
        )
        
        await conn.close()
        
        summary = "TrustVault Transaction Summary:\n"
        for row in decisions:
            summary += f"- {row['decision'].capitalize()}: {row['count']} transactions\n"
            
        summary += "\nRecent Flagged Transactions:\n"
        for row in recent_flagged:
            flags = json.loads(row['risk_flags']) if isinstance(row['risk_flags'], str) else row['risk_flags']
            summary += f"- ID {row['id'][:8]}: ${row['amount']} at {row['merchant_name']} -> {row['decision'].upper()} (Flags: {flags})\n"
            
        return summary
    except Exception as e:
        return f"Error connecting to TrustVault database: {str(e)}\nMake sure docker-compose is running!"

if __name__ == "__main__":
    print("Running TrustVault Analysis...")
    result = asyncio.run(analyze_transactions())
    print(result)
