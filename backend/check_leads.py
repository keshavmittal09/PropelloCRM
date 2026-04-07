import urllib.request, json
try:
    r = urllib.request.urlopen("http://localhost:8000/api/leads")
    data = json.loads(r.read().decode())
    print(f"Total Leads: {len(data)}")
    for item in data:
        contact_name = item.get("contact", {}).get("name", "Unknown")
        source = item.get("source", "Unknown")
        score = item.get("lead_score", "Unknown")
        ai = "YES" if item.get("ai_analysis") else "NO"
        print(f"Lead: {contact_name}, Source: {source}, Score: {score}, AI Analyzed: {ai}")
except Exception as e:
    print("Error:", e)
