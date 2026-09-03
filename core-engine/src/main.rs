use axum::{
    routing::{get, post},
    Router,
    Json,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::mpsc;

use tracing::{info, error};
use deadpool_redis::{Config, Runtime};

mod transaction;
use transaction::{process_transaction_worker, TransactionTask, AppState};

#[derive(Debug, Deserialize, Serialize)]
pub struct TransactionRequest {
    pub user_id: String,
    pub amount: f64,
    pub currency: String,
    pub recipient_id: String,
}

#[derive(Debug, Serialize)]
pub struct TransactionResponse {
    pub status: String,
    pub transaction_id: String,
}

async fn health_check() -> &'static str {
    "OK"
}

async fn handle_transaction(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<TransactionRequest>,
) -> Json<TransactionResponse> {
    // Generate a quick TX ID
    let tx_id = uuid::Uuid::new_v4().to_string();

    let task = TransactionTask {
        tx_id: tx_id.clone(),
        request: payload,
    };

    // Send to lock-free ingest queue
    // We ignore the error for now (in production, handle queue full scenarios)
    let _ = state.tx_queue.send(task).await;

    Json(TransactionResponse {
        status: "processing".to_string(),
        transaction_id: tx_id,
    })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();
    info!("Starting Trust-Vault Core Engine (Rust)");

    // Initialize Redis pool
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379/".to_string());
    let cfg = Config::from_url(redis_url);
    let redis_pool = cfg.create_pool(Some(Runtime::Tokio1)).unwrap_or_else(|e| {
        error!("Failed to create Redis pool: {}", e);
        panic!("Redis pool creation failed");
    });

    // Initialize MPSC channel for transaction ingestion
    // High capacity queue for backpressure handling (e.g. 1 million capacity)
    let (tx_queue, rx_queue) = mpsc::channel::<TransactionTask>(1_000_000);

    let state = Arc::new(AppState { tx_queue, redis_pool: redis_pool.clone() });

    // Spawn the background worker for processing transactions
    tokio::spawn(async move {
        process_transaction_worker(rx_queue, redis_pool).await;
    });

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/transactions", post(handle_transaction))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    info!("Listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
