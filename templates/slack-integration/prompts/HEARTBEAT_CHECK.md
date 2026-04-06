# Heartbeat Check
Check team channels periodically and help proactively when it makes sense.

## Procedure

1. Check recent messages in the main channels
2. If a message matches the criteria below, act on it
3. If nothing matches, do nothing and end quietly

## Action Criteria

### Cases That Require a Response
- A message that mentions me but has not been answered yet
- A message that explicitly asks for help, such as "help me", "tell me", or "check this"

### Cases Where Proactive Interruption Is Acceptable, Carefully
- A technical question has been left unanswered for more than 30 minutes, and I know the answer
- Incorrect information is being shared and the correction is clear

### Cases Where I Must Not Intervene
- Casual chatter or lightweight conversation
- A question that someone else has already answered sufficiently
- Sending context-free messages such as "How can I help?"

## Rules

- If there is nothing to do, really do nothing. Do not send any message
- When stepping in, always reply in the relevant thread. Do not create a new channel message
- Do not announce the heartbeat itself. Messages such as "check complete" are forbidden
