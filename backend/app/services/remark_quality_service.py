"""
Remark Quality AI Scoring Service
---------------------------------
Evaluates task completion remarks using Groq AI.
Returns score 0-10 and feedback string.
"""
import json
import httpx
from typing import Optional
from app.core.config import settings


async def evaluate_remark_quality(remark_text: str) -> dict:
    """
    Evaluate a task completion remark using Groq AI.

    Returns:
        dict: {"score": float 0-10, "feedback": str}
    """
    if not settings.GROQ_API_KEY:
        # Return neutral score if AI not configured
        return {"score": 5.0, "feedback": "AI evaluation not configured"}

    system_prompt = """You are evaluating a real estate sales agent's call remark.
Rate this remark from 0-10 on: detail, accuracy, actionability, professionalism.
Return ONLY valid JSON in this exact format: {"score": number, "feedback": "string"}

Scoring guidelines:
- 0-3: Vague, no useful information, unprofessional
- 4-6: Basic info but lacks detail or actionable next steps
- 7-8: Good detail, clear outcome, next step mentioned
- 9-10: Excellent detail, specific customer quotes, clear action plan, professional tone

Examples:
- "Called, no answer" → score: 2, feedback: "Too brief, no actionable info"
- "Spoke to customer, interested in 2BHK, will call back tomorrow" → score: 6, feedback: "Basic info captured, could include budget or timeline"
- "Discussed with Mr. Sharma. Looking for 3BHK in South Delhi, budget 2-2.5Cr. Wife wants to see property first. Scheduled site visit for Saturday 3pm. Follow up Friday evening to confirm." → score: 9, feedback: "Excellent detail with specific requirements, clear next step"

Remark to evaluate:"""

    user_prompt = remark_text[:3000]  # Truncate to avoid token limits

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.GROQ_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.3,
                    "max_tokens": 200,
                }
            )

            if response.status_code not in (200, 201):
                return {"score": 5.0, "feedback": f"AI service error: {response.status_code}"}

            data = response.json()
            content = data["choices"][0]["message"]["content"].strip()

            # Parse JSON from response (may have markdown code blocks)
            content = content.strip()
            if content.startswith("```json"):
                content = content[7:]
            if content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()

            try:
                result = json.loads(content)
                score = float(result.get("score", 5.0))
                feedback = str(result.get("feedback", "No feedback provided"))

                # Clamp score to 0-10 range
                score = max(0, min(10, score))

                return {"score": round(score, 2), "feedback": feedback[:500]}

            except json.JSONDecodeError:
                # Try to extract numbers from text
                import re
                score_match = re.search(r'score[:\s]*([0-9.]+)', content.lower())
                if score_match:
                    score = float(score_match.group(1))
                    score = max(0, min(10, score))
                    return {"score": round(score, 2), "feedback": content[:500]}
                return {"score": 5.0, "feedback": "Could not parse AI response"}

    except httpx.TimeoutException:
        return {"score": 5.0, "feedback": "AI service timeout"}
    except Exception as e:
        return {"score": 5.0, "feedback": f"AI service error: {str(e)[:100]}"}


async def evaluate_and_update_task(
    db,
    task,
    remark_text: str,
) -> dict:
    """
    Evaluate remark quality and update task record.

    Args:
        db: Database session
        task: Task ORM object
        remark_text: The completion remark text

    Returns:
        dict: Evaluation result with score and feedback
    """
    result = await evaluate_remark_quality(remark_text)

    # Update task with quality score
    task.remark_quality_score = result["score"]
    task.remark_quality_feedback = result["feedback"]

    # Update agent's avg_remark_quality (rolling average)
    from sqlalchemy import select, func
    from app.models.models import Task

    stmt = select(
        func.avg(Task.remark_quality_score)
    ).where(
        Task.assigned_to == task.assigned_to,
        Task.remark_quality_score.isnot(None),
        Task.status == "done"
    )

    result_query = await db.execute(stmt)
    avg_score = result_query.scalar()

    if avg_score is not None:
        # Update agent's average remark quality
        from app.models.agent import Agent
        agent = await db.get(Agent, task.assigned_to)
        if agent:
            agent.avg_remark_quality = round(float(avg_score), 2)

    return result
