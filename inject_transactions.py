import requests
import json
import time

BASE_URL = "http://localhost:8000"

# Note: Update these credentials if you have changed the default seed user passwords
USERNAME = "member"
PASSWORD = "password123" 

def login():
    try:
        print(f"Logging in as {USERNAME}...")
        response = requests.post(f"{BASE_URL}/api/auth/login", json={"username": USERNAME, "password": PASSWORD})
        response.raise_for_status()
        return response.json().get("access_token")
    except Exception as e:
        print(f"Failed to login: {e}")
        print("Tip: Check if the backend is running and the credentials are correct.")
        return None

def inject_suspicious_transaction(token):
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    # Suspicious payload designed to trigger the Fraud & Compliance Rules
    # (High amount + OFAC country)
    payload = {
        "transaction_type": "purchase",
        "amount": 15000,
        "currency": "USD",
        "merchant_name": "Test Darknet Market",
        "merchant_category": "7995",
        "merchant_country": "North Korea",
        "card_member_name": "Test User",
        "description": "Suspicious transfer to mixer",
        "metadata": {
            "ip_location": "Pyongyang",
            "device": "anomalous_proxy_terminal"
        }
    }

    print("Injecting suspicious transaction...")
    try:
        response = requests.post(f"{BASE_URL}/api/transactions/", headers=headers, json=payload)
        
        if response.status_code == 403:
            print("Access Denied! Your IP address is successfully blocked.")
            print(response.json())
        else:
            response.raise_for_status()
            print("Transaction injected successfully!")
            print(response.json())
    except requests.exceptions.HTTPError as e:
        print(f"HTTP Error: {e}")
        try:
            print(e.response.json())
        except:
            pass
    except Exception as e:
        print(f"Error injecting transaction: {e}")

if __name__ == "__main__":
    print("=== TrustVault Suspicous Transaction Injector ===")
    token = login()
    if token:
        print("Waiting a moment before injection...")
        time.sleep(1)
        inject_suspicious_transaction(token)
    else:
        print("Cannot inject transaction without a valid auth token.")
