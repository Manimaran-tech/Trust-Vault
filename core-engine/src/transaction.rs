use crate::TransactionRequest;
use deadpool_redis::redis;
use rskafka::client::{
    ClientBuilder,
    partition::UnknownTopicHandling,
};
use rskafka::record::Record;
use tokio::sync::mpsc::{Receiver, Sender};
use tokio::time::Instant;
use tracing::{info, warn, error};
use deadpool_redis::Pool;

pub struct AppState {
    pub tx_queue: Sender<TransactionTask>,
    pub redis_pool: Pool,
}

#[derive(Debug)]
pub struct TransactionTask {
    pub tx_id: String,
    pub request: TransactionRequest,
}

pub async fn process_transaction_worker(mut rx: Receiver<TransactionTask>, redis_pool: Pool) {
    info!("Transaction processing worker started.");

    // Connect to Kafka using rskafka
    let kafka_client = match ClientBuilder::new(vec!["localhost:9092".to_string()]).build().await {
        Ok(client) => Some(client),
        Err(e) => {
            warn!("Could not connect to Kafka: {}. Running without Kafka.", e);
            None
        }
    };

    let partition_client = if let Some(client) = kafka_client {
        match client
            .partition_client(
                "transactions_topic",
                0,
                UnknownTopicHandling::Retry,
            )
            .await
        {
            Ok(pc) => Some(pc),
            Err(e) => {
                warn!("Could not get Kafka partition: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Batching configuration
    let batch_size = 1000;
    let mut batch = Vec::with_capacity(batch_size);

    loop {
        // Wait for tasks
        if let Some(task) = rx.recv().await {
            batch.push(task);

            // Drain the queue if we have pending items to form a larger batch
            while batch.len() < batch_size {
                if let Ok(next_task) = rx.try_recv() {
                    batch.push(next_task);
                } else {
                    break;
                }
            }

            let start = Instant::now();
            let batch_len = batch.len();

            // 1. In-memory balance check via Redis Pipeline (extremely fast)
            match redis_pool.get().await {
                Ok(mut conn) => {
                    let mut pipeline = redis::pipe();
                    for t in &batch {
                        // Simulating a quick atomic decrement for balance
                        // e.g., HINCRBY user_balances <user_id> -<amount>
                        let amount_cents = (t.request.amount * 100.0) as i64;
                        pipeline.cmd("HINCRBY").arg("balances").arg(&t.request.user_id).arg(-amount_cents);
                    }
                    // Execute pipeline in one round trip
                    let _results: deadpool_redis::redis::RedisResult<Vec<i64>> = pipeline.query_async(&mut conn).await;
                    if let Err(e) = _results {
                        error!("Redis pipeline execution failed: {}", e);
                    }
                }
                Err(e) => {
                    error!("Failed to get Redis connection from pool: {}", e);
                }
            }

            // 2. Publish valid transactions to Kafka
            if let Some(pc) = &partition_client {
                let records: Vec<Record> = batch
                    .iter()
                    .map(|t| {
                        let payload = serde_json::to_vec(&t.request).unwrap();
                        Record {
                            key: Some(t.tx_id.clone().into_bytes()),
                            value: Some(payload),
                            headers: Default::default(),
                            timestamp: chrono::Utc::now(),
                        }
                    })
                    .collect();

                // Produce the batch to Kafka
                if let Err(e) = pc.produce(records, rskafka::client::partition::Compression::NoCompression).await {
                    error!("Failed to produce to Kafka: {}", e);
                }
            }

            let duration = start.elapsed();
            info!("Processed batch of {} transactions in {:?}", batch_len, duration);

            batch.clear();
        }
    }
}
