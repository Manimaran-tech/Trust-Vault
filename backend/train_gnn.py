import os
import torch
import torch.nn.functional as F
from torch_geometric.data import Data
from torch_geometric.nn import SAGEConv
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class TransactionGraphSAGE(torch.nn.Module):
    """
    GraphSAGE model for learning node embeddings from transaction graphs.
    """
    def __init__(self, in_channels=8, hidden_channels=64, out_channels=32):
        super().__init__()
        self.conv1 = SAGEConv(in_channels, hidden_channels)
        self.conv2 = SAGEConv(hidden_channels, out_channels)

    def forward(self, x, edge_index):
        x = self.conv1(x, edge_index)
        x = F.relu(x)
        x = self.conv2(x, edge_index)
        return x

def create_synthetic_dataset(num_nodes=1000):
    """
    Creates a synthetic dataset of transaction nodes (Users, Merchants, IPs).
    Injects a few 'fraud' clusters (high density subgraphs).
    """
    logger.info(f"Generating synthetic graph dataset with {num_nodes} nodes...")
    
    # Node features (8-dimensional: e.g. amount, velocity, location risk, etc.)
    # Normal nodes:
    x = torch.randn(num_nodes, 8)
    
    # Inject an anomaly pattern for some nodes
    anomaly_indices = torch.randperm(num_nodes)[:50]
    x[anomaly_indices] += 5.0 # Distinct feature shift
    
    # Generate edges (Random graph for normal, dense clusters for anomalies)
    edge_index_src = []
    edge_index_dst = []
    
    # Normal sparse connections
    for i in range(num_nodes):
        if i not in anomaly_indices:
            num_edges = torch.randint(1, 5, (1,)).item()
            targets = torch.randint(0, num_nodes, (num_edges,))
            edge_index_src.extend([i] * num_edges)
            edge_index_dst.extend(targets.tolist())
            
    # Anomalous dense connections (e.g. coordinated botnet/sybil attack)
    for i in anomaly_indices:
        # High degree centrality burst
        targets = anomaly_indices[torch.randperm(len(anomaly_indices))[:20]]
        edge_index_src.extend([i.item()] * 20)
        edge_index_dst.extend(targets.tolist())

    edge_index = torch.tensor([edge_index_src, edge_index_dst], dtype=torch.long)
    
    # Labels (1 = Fraud, 0 = Normal) - just for supervised contrastive training
    y = torch.zeros(num_nodes, dtype=torch.long)
    y[anomaly_indices] = 1
    
    return Data(x=x, edge_index=edge_index, y=y)

def train_model():
    """
    Trains the GraphSAGE model using a simple contrastive/classification approach.
    """
    data = create_synthetic_dataset()
    model = TransactionGraphSAGE()
    optimizer = torch.optim.Adam(model.parameters(), lr=0.01)
    
    # Simple binary classification head on top of embeddings for training
    classifier = torch.nn.Linear(32, 2)
    optimizer.add_param_group({'params': classifier.parameters()})
    
    logger.info("Training GNN model (100 epochs)...")
    model.train()
    for epoch in range(100):
        optimizer.zero_grad()
        embeddings = model(data.x, data.edge_index)
        out = classifier(embeddings)
        loss = F.cross_entropy(out, data.y)
        loss.backward()
        optimizer.step()
        
        if (epoch + 1) % 20 == 0:
            logger.info(f"Epoch {epoch+1:03d} - Loss: {loss.item():.4f}")
            
    # Ensure models directory exists
    os.makedirs("models", exist_ok=True)
    
    # Save the trained weights
    model_path = "models/graphsage_fraud_pretrained.pt"
    torch.save(model.state_dict(), model_path)
    logger.info(f"✅ Successfully trained and saved GNN weights to: {model_path}")
    
    # Save a generic "normal" centroid for anomaly distance calculation
    model.eval()
    with torch.no_grad():
        final_embeddings = model(data.x, data.edge_index)
        normal_centroid = final_embeddings[data.y == 0].mean(dim=0)
        torch.save(normal_centroid, "models/graphsage_normal_centroid.pt")
    logger.info("✅ Saved normal centroid for anomaly detection distance calculation.")

if __name__ == "__main__":
    train_model()
