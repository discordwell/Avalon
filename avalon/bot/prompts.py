from __future__ import annotations

from typing import Dict, List

from ..models import GameState, Phase, Player, Role
from ..game import alignment_for, team_size


def build_system_prompt(player: Player, knowledge: List[str]) -> str:
    role = player.role.value if player.role else "Unknown"
    alignment = alignment_for(player.role).value if player.role else "Unknown"
    facts = "\n".join(f"- {item}" for item in knowledge) or "- None"
    return (
        "You are a player in Avalon. Act in character and to win for your alignment.\n"
        f"Role: {role}\n"
        f"Alignment: {alignment}\n"
        "Known facts:\n"
        f"{facts}\n"
        "Always output a single JSON object with keys: action_type and payload."
    )


def build_context(state: GameState, player_id: str, recent_chat: List[str]) -> str:
    leader = state.players[state.leader_index]
    team_needed = team_size(state.config.player_count, state.quest_number)
    id_to_name = {p.id: p.name for p in state.players}
    proposed_names = [id_to_name.get(pid, pid) for pid in state.proposed_team]
    return (
        "Current game state:\n"
        f"Phase: {state.phase}\n"
        f"Quest: {state.quest_number}\n"
        f"Leader: {leader.name}\n"
        f"Team size needed: {team_needed}\n"
        f"Proposal attempts (rejected): {state.proposal_attempts}\n"
        f"Proposed team: {', '.join(proposed_names) or 'None'}\n"
        f"Successes: {state.success_count} | Fails: {state.fail_count}\n"
        "Recent chat:\n"
        + "\n".join(recent_chat or ["(none)"])
    )


def build_action_instructions(state: GameState, player: Player) -> str:
    if state.phase == Phase.team_proposal:
        return (
            "You are the leader. Propose a team. Output JSON like: "
            '{"action_type":"propose_team","payload":{"team":["id1","id2"]}}'
        )
    if state.phase == Phase.team_vote:
        return (
            "Vote to approve or reject the team. Output JSON like: "
            '{"action_type":"vote_team","payload":{"approve":true}}'
        )
    if state.phase == Phase.quest:
        return (
            "Submit quest vote. Loyal must choose success. Output JSON like: "
            '{"action_type":"quest_vote","payload":{"success":true}}'
        )
    if state.phase == Phase.assassination and player.role == Role.assassin:
        return (
            "Choose a target to assassinate. Output JSON like: "
            '{"action_type":"assassinate","payload":{"target_id":"id"}}'
        )
    if state.phase == Phase.lady_of_lake and state.lady_holder_id == player.id:
        return (
            "Use Lady of the Lake to view alignment. Output JSON like: "
            '{"action_type":"lady_peek","payload":{"target_id":"id"}}'
        )
    return "If you have no required action, output {\"action_type\":\"chat\",\"payload\":{\"message\":\"pass\"}}"
