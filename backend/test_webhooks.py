import urllib.request, json

# Test 1: Website lead
lead_data = json.dumps({
    "name": "Rahul Sharma",
    "phone": "9876543210",
    "email": "rahul@gmail.com",
    "budget": "80L",
    "location": "Vashi",
    "property_type": "apartment",
    "message": "Looking for 2BHK in Vashi near station"
}).encode()

req = urllib.request.Request(
    "http://localhost:8000/api/webhooks/website",
    data=lead_data,
    headers={"Content-Type": "application/json"}
)
try:
    r = urllib.request.urlopen(req)
    result = json.loads(r.read().decode())
    print("=== Website Webhook: SUCCESS ===")
    print(f"  Lead ID: {result['lead_id']}")
    print(f"  Contact ID: {result['contact_id']}")
    print(f"  Score: {result['lead_score']}")
    print(f"  Returning: {result['is_returning_caller']}")
    print(f"  Assigned to: {result['assigned_to']}")
except Exception as e:
    print(f"Website Webhook ERROR: {e}")
    if hasattr(e, "read"):
        print("Body:", e.read().decode()[:500])

# Test 2: Priya AI webhook
print()
lead_data2 = json.dumps({
    "source": "priya_ai",
    "name": "Anjali Patel",
    "phone": "9988776655",
    "email": "anjali@gmail.com",
    "budget_min": 5000000,
    "budget_max": 8000000,
    "property_type": "apartment",
    "location_preference": "Powai",
    "timeline": "1_month",
    "transcript_summary": "Client wants 3BHK in Powai, budget 50L-80L, immediate timeline",
    "call_duration_seconds": 245,
    "personal_notes": "Has 2 kids, needs school nearby"
}).encode()

req2 = urllib.request.Request(
    "http://localhost:8000/api/webhooks/priya",
    data=lead_data2,
    headers={"Content-Type": "application/json", "X-Priya-Secret": "priya-secret-change-in-prod"}
)
try:
    r = urllib.request.urlopen(req2)
    result = json.loads(r.read().decode())
    print("=== Priya Webhook: SUCCESS ===")
    print(f"  Lead ID: {result['lead_id']}")
    print(f"  Score: {result['lead_score']}")
    print(f"  Returning: {result['is_returning_caller']}")
except Exception as e:
    print(f"Priya Webhook ERROR: {e}")
    if hasattr(e, "read"):
        print("Body:", e.read().decode()[:500])

# Test 3: Facebook webhook
print()
lead_data3 = json.dumps({
    "name": "Vikram Singh",
    "phone": "9112233445",
    "email": "vikram@hotmail.com",
    "city": "Thane",
    "budget": "1.2Cr",
    "property_type": "villa"
}).encode()

req3 = urllib.request.Request(
    "http://localhost:8000/api/webhooks/facebook",
    data=lead_data3,
    headers={"Content-Type": "application/json"}
)
try:
    r = urllib.request.urlopen(req3)
    result = json.loads(r.read().decode())
    print("=== Facebook Webhook: SUCCESS ===")
    print(f"  Lead ID: {result['lead_id']}")
    print(f"  Score: {result['lead_score']}")
except Exception as e:
    print(f"Facebook Webhook ERROR: {e}")
    if hasattr(e, "read"):
        print("Body:", e.read().decode()[:500])

# Test 4: 99acres webhook
print()
lead_data4 = json.dumps({
    "name": "Priya Desai",
    "phone": "9001122334",
    "email": "priya.d@gmail.com",
    "property_type": "apartment",
    "location": "Andheri",
    "budget": "60L",
    "message": "Interested in 2BHK flat in Andheri West"
}).encode()

req4 = urllib.request.Request(
    "http://localhost:8000/api/webhooks/99acres",
    data=lead_data4,
    headers={"Content-Type": "application/json"}
)
try:
    r = urllib.request.urlopen(req4)
    result = json.loads(r.read().decode())
    print("=== 99acres Webhook: SUCCESS ===")
    print(f"  Lead ID: {result['lead_id']}")
    print(f"  Score: {result['lead_score']}")
except Exception as e:
    print(f"99acres Webhook ERROR: {e}")
    if hasattr(e, "read"):
        print("Body:", e.read().decode()[:500])

# Test 5: Duplicate — Rahul again via different source
print()
lead_data5 = json.dumps({
    "source": "manual",
    "name": "Rahul Sharma",
    "phone": "9876543210",
    "email": "rahul@gmail.com",
    "budget_max": 10000000,
    "location_preference": "Vashi",
    "timeline": "immediate"
}).encode()

req5 = urllib.request.Request(
    "http://localhost:8000/api/webhooks/generic",
    data=lead_data5,
    headers={"Content-Type": "application/json"}
)
try:
    r = urllib.request.urlopen(req5)
    result = json.loads(r.read().decode())
    print("=== Duplicate Test: SUCCESS ===")
    print(f"  Returning caller: {result['is_returning_caller']}")
    print(f"  Score: {result['lead_score']}")
except Exception as e:
    print(f"Duplicate Test ERROR: {e}")
    if hasattr(e, "read"):
        print("Body:", e.read().decode()[:500])

# Test 6: Health check + version
print()
r = urllib.request.urlopen("http://localhost:8000/")
print(f"\nAPI Root: {r.read().decode()}")
