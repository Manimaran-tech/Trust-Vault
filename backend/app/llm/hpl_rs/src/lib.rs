use pyo3::prelude::*;

#[pyfunction]
fn check_factual_consistency(reasoning: &str, amount: f64, merchant_country: &str) -> PyResult<Vec<String>> {
    let mut errors = Vec::new();
    let reasoning_lower = reasoning.to_lowercase();
    let merchant_country_lower = merchant_country.to_lowercase();
    
    // 1. Categorical Checks
    let high_risk = ["north korea", "iran", "syria", "cuba", "crimea", "russia", "venezuela", "myanmar", "belarus"];
    
    for &country in &high_risk {
        if reasoning_lower.contains(country) && !merchant_country_lower.contains(country) {
            errors.push(format!("Hallucinated high-risk entity: '{}'. The transaction payload does not support this.", country));
        }
    }
    
    // 2. Numerical Checks (Optimized)
    let mut current_num = String::new();
    let mut parsing_num = false;
    
    let chars: Vec<char> = reasoning.chars().collect();
    for i in 0..chars.len() {
        let c = chars[i];
        if c == '$' || c.is_digit(10) {
            if !parsing_num {
                parsing_num = true;
                current_num.clear();
            }
            if c != '$' && c != ',' {
                current_num.push(c);
            }
        } else if c == '.' && parsing_num {
            current_num.push(c);
        } else if parsing_num {
            // Reached end of number
            if let Ok(val) = current_num.parse::<f64>() {
                let thresholds = [5000.0, 10000.0, 15000.0, 25000.0, 50000.0, 75000.0, 150000.0, 200000.0, 500000.0];
                let is_threshold = thresholds.iter().any(|&t| (val - t).abs() < 0.1);
                
                if !is_threshold && val >= 1000.0 && (val - amount).abs() > 1.0 {
                    errors.push(format!("Hallucinated numerical value: {}. Actual transaction amount is {}.", val, amount));
                    break; // Limit to one numerical error
                }
            }
            parsing_num = false;
        }
    }
    
    if parsing_num {
        if let Ok(val) = current_num.parse::<f64>() {
            let thresholds = [5000.0, 10000.0, 15000.0, 25000.0, 50000.0, 75000.0, 150000.0, 200000.0, 500000.0];
            let is_threshold = thresholds.iter().any(|&t| (val - t).abs() < 0.1);
            if !is_threshold && val >= 1000.0 && (val - amount).abs() > 1.0 {
                errors.push(format!("Hallucinated numerical value: {}. Actual transaction amount is {}.", val, amount));
            }
        }
    }

    Ok(errors)
}

#[pymodule]
fn hpl_rs(_py: Python, m: &PyModule) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(check_factual_consistency, m)?)?;
    Ok(())
}
