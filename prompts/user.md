Please evaluate the following transcript according to the scoring rubric provided in the system instructions.

You MUST return your response as a valid JSON object matching this exact schema:

{
  "communication_professionalism": {
    "greeting_verification": <integer 0-5>,
    "active_listening_empathy": <integer 0-5>,
    "probing_issue": <integer 0-5>,
    "validating_priority": <integer 0-5>
  },
  "technical_accuracy": {
    "accurate_troubleshooting": <integer 0-10>,
    "solution_accuracy": <integer 0-10>,
    "valid_escalation": <integer 0-5>,
    "knowledge_base_use": -1
  },
  "process_adherence": {
    "critical_compliance": <integer 0-5>,
    "ticket_documentation": <integer 0-10>,
    "time_entry_agreement": <integer 0-5>
  },
  "customer_experience": {
    "incident_ownership": <integer 0-5>,
    "stakeholder_communication": <integer 0-10>,
    "proper_closing_satisfaction": <integer 0-5>
  },
  "efficiency_metrics": {
    "first_call_resolution": <integer 0-5>,
    "thirty_minute_rule": <integer 0-3>,
    "minimal_transfers_holds": <integer 0-2>
  },
  "overall_score_percentage": <integer 0-100>,
  "technical_reviewer_feedback": "<String detailing specific areas of improvement based ONLY on the transcript>"
}

---
Transcript to Evaluate:
{transcript_text}
---
