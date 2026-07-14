from sqlalchemy import Column, String, Integer, Float, Date, DateTime, JSON, ForeignKey, func
from sqlalchemy.orm import relationship
from app.db.base import Base

class MetaCampaign(Base):
    __tablename__ = "meta_campaigns"
    
    id = Column(String, primary_key=True)  # The Facebook Campaign ID
    ad_account_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    status = Column(String)
    objective = Column(String)
    created_time = Column(DateTime)
    
    insights = relationship("MetaAdInsight", back_populates="campaign", cascade="all, delete-orphan")

class MetaAdInsight(Base):
    __tablename__ = "meta_ad_insights"
    
    id = Column(String, primary_key=True)  # Usually combination of campaign_id and date
    campaign_id = Column(String, ForeignKey("meta_campaigns.id"), nullable=False, index=True)
    date_start = Column(Date, nullable=False, index=True)
    date_stop = Column(Date, nullable=False)
    
    spend = Column(Float, default=0.0)
    impressions = Column(Integer, default=0)
    clicks = Column(Integer, default=0)
    cpc = Column(Float, default=0.0)
    cpm = Column(Float, default=0.0)
    cpp = Column(Float, default=0.0)
    ctr = Column(Float, default=0.0)
    
    # Store standard events (like leads) here
    actions = Column(JSON, default=list)
    action_values = Column(JSON, default=list)
    
    last_synced_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    campaign = relationship("MetaCampaign", back_populates="insights")
