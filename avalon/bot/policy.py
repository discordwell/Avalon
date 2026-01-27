from __future__ import annotations

import random
from typing import Dict, List

from ..config import SETTINGS
from ..game import alignment_for, team_size
from ..models import Alignment, GameState, Player, Role
from .llm import LLMClient
from .prompts import build_action_instructions, build_context, build_system_prompt


class BotPolicy:
    def __init__(self) -> None:
        self._llm = LLMClient()

    def decide(self, state: GameState, player: Player, knowledge: List[str]) -> Dict:
        recent_chat = [f"{msg.player_id}: {msg.message}" for msg in state.chat[-SETTINGS.max_recent_chat :]]
        if SETTINGS.bot_mode == "llm":
            prompt = self._build_prompt(state, player, knowledge, recent_chat)
            result = self._llm.generate_json(prompt)
            return result.data
        return self._heuristic(state, player)

    def _build_prompt(
        self, state: GameState, player: Player, knowledge: List[str], recent_chat: List[str]
    ) -> str:
        system = build_system_prompt(player, knowledge)
        context = build_context(state, player.id, recent_chat)
        instructions = build_action_instructions(state, player)
        return f"{system}\n\n{context}\n\n{instructions}"

    def _heuristic(self, state: GameState, player: Player) -> Dict:
        if state.phase == "team_proposal":
            size = team_size(state.config.player_count, state.quest_number)
            ids = [p.id for p in state.players]
            team = [player.id] + random.sample([pid for pid in ids if pid != player.id], k=size - 1)
            return {"action_type": "propose_team", "payload": {"team": team}}
        if state.phase == "team_vote":
            if player.role and alignment_for(player.role) == Alignment.evil:
                approve = any(pid in state.proposed_team for pid in self._evil_ids(state))
                approve = approve or random.random() < 0.3
            else:
                approve = player.id in state.proposed_team or random.random() < 0.4
            return {"action_type": "vote_team", "payload": {"approve": approve}}
        if state.phase == "quest":
            if player.role and alignment_for(player.role) == Alignment.evil:
                success = random.random() > 0.7
            else:
                success = True
            return {"action_type": "quest_vote", "payload": {"success": success}}
        if state.phase == "assassination" and player.role == Role.assassin:
            candidates = [p.id for p in state.players if p.id != player.id]
            return {"action_type": "assassinate", "payload": {"target_id": random.choice(candidates)}}
        if state.phase == "lady_of_lake" and state.lady_holder_id == player.id:
            candidates = [p.id for p in state.players if p.id != player.id]
            return {"action_type": "lady_peek", "payload": {"target_id": random.choice(candidates)}}
        return {"action_type": "chat", "payload": {"message": "pass"}}

    @staticmethod
    def _evil_ids(state: GameState) -> List[str]:
        return [p.id for p in state.players if p.role and alignment_for(p.role) == Alignment.evil]
