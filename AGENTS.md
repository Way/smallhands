# Harmony Integration

This project uses Harmony for task management. When working on tasks:

## Starting Work on a Card

When given a card reference (e.g., #42 or a card name), follow this workflow:

1. Use `harmony_get_card_by_short_id` or `harmony_search_cards` to find the card
2. Move the card to "In Progress" using `harmony_move_card`
3. Add the "agent" label using `harmony_add_label_to_card`
4. Start a session with `harmony_start_agent_session` (agentIdentifier: "codex", agentName: "OpenAI Codex")
5. Show the card details to the user
6. Use `harmony_generate_prompt` to get guidance, then implement the solution
7. Update progress periodically with `harmony_update_agent_progress`
8. When done, call `harmony_end_agent_session` and move to "Review"

## Auto-Detect Card for Implementation Tasks

Before implementing a plan or feature, check if it maps to an existing Harmony card:

1. Use `harmony_search_cards` with keywords from the task description
2. If a match is found, call `harmony_start_agent_session` (agentIdentifier: "claude-code", agentName: "Claude Code", moveToColumn: "In Progress", addLabels: ["agent"])
3. Update progress with `harmony_update_agent_progress` at milestones
4. When done, call `harmony_end_agent_session` with status: "completed", moveToColumn: "Review"

Skip if: work was already started with a card reference, or no matching card exists.

## Available Harmony Tools

- `harmony_get_card`, `harmony_get_card_by_short_id`, `harmony_search_cards` - Find cards
- `harmony_move_card` - Move cards between columns
- `harmony_add_label_to_card`, `harmony_remove_label_from_card` - Manage labels
- `harmony_start_agent_session`, `harmony_update_agent_progress`, `harmony_end_agent_session` - Track work
- `harmony_get_board` - Get board state
- `harmony_generate_prompt` - Get role-based guidance and focus areas for the card
