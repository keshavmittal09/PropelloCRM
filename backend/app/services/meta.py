import httpx
import os
import logging
from datetime import datetime, timedelta
from sqlalchemy import select
from app.db.base import AsyncSessionLocal
from app.models.meta_ads import MetaCampaign, MetaAdInsight

logger = logging.getLogger(__name__)

async def sync_meta_ads():
    META_ACCESS_TOKEN = os.getenv("META_ACCESS_TOKEN")
    META_AD_ACCOUNT_ID = os.getenv("META_AD_ACCOUNT_ID")
    
    if not META_ACCESS_TOKEN or not META_AD_ACCOUNT_ID:
        logger.warning("Meta Ads API tokens missing. Skipping sync.")
        return
        
    # Ensure AD account ID starts with 'act_' as required by the Graph API
    if not META_AD_ACCOUNT_ID.startswith('act_'):
        META_AD_ACCOUNT_ID = f"act_{META_AD_ACCOUNT_ID}"
        
    # Endpoint to fetch campaigns
    url = f"https://graph.facebook.com/v19.0/{META_AD_ACCOUNT_ID}/campaigns"
    params = {
        "access_token": META_ACCESS_TOKEN,
        "fields": "id,name,status,objective,created_time",
        "limit": "100"
    }

    try:
        async with httpx.AsyncClient() as client:
            # Sync campaigns
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            campaigns_data = resp.json().get("data", [])
            
            async with AsyncSessionLocal() as db:
                for camp in campaigns_data:
                    c = await db.get(MetaCampaign, camp["id"])
                    if not c:
                        c = MetaCampaign(id=camp["id"], ad_account_id=META_AD_ACCOUNT_ID)
                        db.add(c)
                    c.name = camp.get("name")
                    c.status = camp.get("status")
                    c.objective = camp.get("objective")
                    ct = camp.get("created_time")
                    if ct:
                        c.created_time = datetime.strptime(ct[:19], "%Y-%m-%dT%H:%M:%S")
                await db.commit()
                
            # Sync daily insights covering the last 30 days
            since = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%d")
            until = datetime.utcnow().strftime("%Y-%m-%d")
            
            insights_url = f"https://graph.facebook.com/v19.0/{META_AD_ACCOUNT_ID}/insights"
            insights_params = {
                "access_token": META_ACCESS_TOKEN,
                "fields": "campaign_id,spend,impressions,clicks,cpc,cpm,cpp,ctr,actions,action_values",
                "level": "campaign",
                "time_range": f'{{"since":"{since}","until":"{until}"}}',
                "limit": "100",
                "time_increment": "1" # Daily granularity
            }
            
            resp = await client.get(insights_url, params=insights_params)
            resp.raise_for_status()
            insights_data = resp.json().get("data", [])
            
            async with AsyncSessionLocal() as db:
                for item in insights_data:
                    camp_id = item.get("campaign_id")
                    date_start = item.get("date_start")
                    
                    if not camp_id or not date_start:
                        continue
                        
                    insight_id = f"{camp_id}_{date_start}"
                    ins = await db.get(MetaAdInsight, insight_id)
                    if not ins:
                        ins = MetaAdInsight(id=insight_id, campaign_id=camp_id)
                        db.add(ins)
                        
                    ins.date_start = datetime.strptime(date_start, "%Y-%m-%d").date()
                    date_stop = item.get("date_stop")
                    if date_stop:
                        ins.date_stop = datetime.strptime(date_stop, "%Y-%m-%d").date()
                    
                    ins.spend = float(item.get("spend", 0))
                    ins.impressions = int(item.get("impressions", 0))
                    ins.clicks = int(item.get("clicks", 0))
                    ins.cpc = float(item.get("cpc", 0))
                    ins.cpm = float(item.get("cpm", 0))
                    ins.cpp = float(item.get("cpp", 0))
                    ins.ctr = float(item.get("ctr", 0))
                    ins.actions = item.get("actions", [])
                    ins.action_values = item.get("action_values", [])
                    
                await db.commit()
                logger.info(f"Meta Ads synced: {len(campaigns_data)} campaigns, {len(insights_data)} insight rows.")
    except Exception as e:
        logger.error(f"Failed to sync Meta ads: {str(e)}")
