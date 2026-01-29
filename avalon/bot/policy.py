from __future__ import annotations

import logging
import random
from typing import Dict, List, Optional

from ..config import SETTINGS
from ..game import alignment_for, team_size
from ..models import Alignment, GameState, Phase, Player, Role
from .llm import LLMClient, ExtractionResult
from .prompts import build_action_instructions, build_context, build_system_prompt

logger = logging.getLogger(__name__)


class BotPolicy:
    def __init__(self) -> None:
        self._llm = LLMClient()

    def decide(self, state: GameState, player: Player, knowledge: List[str]) -> Dict:
        """Main decision method - tries LLM first, falls back to heuristic."""
        if SETTINGS.bot_mode != "llm":
            return self._heuristic(state, player)

        recent_chat = [f"{msg.player_id}: {msg.message}" for msg in state.chat[-SETTINGS.max_recent_chat:]]
        prompt = self._build_prompt(state, player, knowledge, recent_chat)

        # Route to phase-specific handlers
        try:
            if state.phase == Phase.team_proposal:
                return self._decide_team_proposal(prompt, state, player)
            elif state.phase == Phase.team_vote:
                return self._decide_team_vote(prompt, state, player)
            elif state.phase == Phase.quest:
                return self._decide_quest(prompt, state, player)
            elif state.phase == Phase.assassination and player.role == Role.assassin:
                return self._decide_assassination(prompt, state, player)
            elif state.phase == Phase.lady_of_lake and state.lady_holder_id == player.id:
                return self._decide_lady_of_lake(prompt, state, player)
        except Exception as e:
            logger.error(f"LLM decision failed: {e}, falling back to heuristic")

        return self._heuristic(state, player)

    def _build_prompt(
        self, state: GameState, player: Player, knowledge: List[str], recent_chat: List[str]
    ) -> str:
        system = build_system_prompt(player, knowledge)
        context = build_context(state, player.id, recent_chat)
        instructions = build_action_instructions(state, player)
        return f"{system}\n\n{context}\n\n{instructions}"

    # --- Phase-specific decision methods ---

    def _decide_team_proposal(self, prompt: str, state: GameState, player: Player) -> Dict:
        """Handle team proposal with LLM + validation + fallback."""
        required_size = team_size(state.config.player_count, state.quest_number)

        def extractor(text: str) -> ExtractionResult:
            result = LLMClient.extract_team(text)
            if not result.success:
                return result
            # Resolve names to IDs
            names = result.value
            ids = []
            for name in names:
                player_id = self._resolve_name_to_id(state, name)
                if player_id is None:
                    return ExtractionResult(
                        success=False, value=None, error=f"Unknown player: '{name}'"
                    )
                if player_id in ids:
                    return ExtractionResult(
                        success=False, value=None, error=f"Duplicate player: '{name}'"
                    )
                ids.append(player_id)
            # Validate team size
            if len(ids) != required_size:
                return ExtractionResult(
                    success=False,
                    value=None,
                    error=f"Team must have exactly {required_size} players, got {len(ids)}",
                )
            return ExtractionResult(success=True, value=ids)

        result = self._llm.generate_with_retry(prompt, extractor)
        if result.success:
            logger.info(f"LLM proposed team: {result.value}")
            return {"action_type": "propose_team", "payload": {"team": result.value}}

        logger.warning(f"LLM team proposal failed: {result.error}, using heuristic")
        return self._heuristic(state, player)

    def _decide_team_vote(self, prompt: str, state: GameState, player: Player) -> Dict:
        """Handle team vote with LLM + fallback."""
        result = self._llm.generate_with_retry(prompt, LLMClient.extract_vote)
        if result.success:
            logger.info(f"LLM voted: {'APPROVE' if result.value else 'REJECT'}")
            return {"action_type": "vote_team", "payload": {"approve": result.value}}

        logger.warning(f"LLM vote failed: {result.error}, using heuristic")
        return self._heuristic(state, player)

    def _decide_quest(self, prompt: str, state: GameState, player: Player) -> Dict:
        """Handle quest vote with LLM + fallback."""
        result = self._llm.generate_with_retry(prompt, LLMClient.extract_quest)
        if result.success:
            logger.info(f"LLM quest vote: {'SUCCESS' if result.value else 'FAIL'}")
            return {"action_type": "quest_vote", "payload": {"success": result.value}}

        logger.warning(f"LLM quest vote failed: {result.error}, using heuristic")
        return self._heuristic(state, player)

    def _decide_assassination(self, prompt: str, state: GameState, player: Player) -> Dict:
        """Handle assassination with LLM + validation + fallback."""
        # Defer to human evil teammates if present
        if self._has_human_evil_player(state):
            logger.info("Bot assassin deferring to human evil player for assassination decision")
            return {"action_type": "chat", "payload": {"message": "pass"}}

        def extractor(text: str) -> ExtractionResult:
            result = LLMClient.extract_target(text, "TARGET")
            if not result.success:
                return result
            # Resolve name to ID
            target_id = self._resolve_name_to_id(state, result.value)
            if target_id is None:
                return ExtractionResult(
                    success=False, value=None, error=f"Unknown player: '{result.value}'"
                )
            # Can't target self
            if target_id == player.id:
                return ExtractionResult(
                    success=False, value=None, error="Cannot assassinate yourself"
                )
            return ExtractionResult(success=True, value=target_id)

        result = self._llm.generate_with_retry(prompt, extractor)
        if result.success:
            logger.info(f"LLM assassination target: {result.value}")
            return {"action_type": "assassinate", "payload": {"target_id": result.value}}

        logger.warning(f"LLM assassination failed: {result.error}, using heuristic")
        return self._heuristic(state, player)

    def _decide_lady_of_lake(self, prompt: str, state: GameState, player: Player) -> Dict:
        """Handle Lady of the Lake with LLM + validation + fallback."""

        def extractor(text: str) -> ExtractionResult:
            result = LLMClient.extract_target(text, "INSPECT")
            if not result.success:
                return result
            # Resolve name to ID
            target_id = self._resolve_name_to_id(state, result.value)
            if target_id is None:
                return ExtractionResult(
                    success=False, value=None, error=f"Unknown player: '{result.value}'"
                )
            # Can't target self
            if target_id == player.id:
                return ExtractionResult(
                    success=False, value=None, error="Cannot inspect yourself"
                )
            return ExtractionResult(success=True, value=target_id)

        result = self._llm.generate_with_retry(prompt, extractor)
        if result.success:
            logger.info(f"LLM Lady of Lake target: {result.value}")
            return {"action_type": "lady_peek", "payload": {"target_id": result.value}}

        logger.warning(f"LLM Lady of Lake failed: {result.error}, using heuristic")
        return self._heuristic(state, player)

    # --- Helper methods ---

    def _resolve_name_to_id(self, state: GameState, name: str) -> Optional[str]:
        """Convert a player name to their ID (case-insensitive, partial match)."""
        name_lower = name.lower().strip()

        # First try exact match (case-insensitive)
        for p in state.players:
            if p.name.lower() == name_lower:
                return p.id

        # Then try partial match
        for p in state.players:
            if name_lower in p.name.lower() or p.name.lower() in name_lower:
                return p.id

        return None

    def _heuristic(self, state: GameState, player: Player) -> Dict:
        """Fallback heuristic decision-making."""
        if state.phase == Phase.team_proposal:
            size = team_size(state.config.player_count, state.quest_number)
            ids = [p.id for p in state.players]
            team = [player.id] + random.sample([pid for pid in ids if pid != player.id], k=size - 1)
            return {"action_type": "propose_team", "payload": {"team": team}}

        if state.phase == Phase.team_vote:
            if player.role and alignment_for(player.role) == Alignment.evil:
                approve = any(pid in state.proposed_team for pid in self._evil_ids(state))
                approve = approve or random.random() < 0.3
            else:
                approve = player.id in state.proposed_team or random.random() < 0.4
            return {"action_type": "vote_team", "payload": {"approve": approve}}

        if state.phase == Phase.quest:
            if player.role and alignment_for(player.role) == Alignment.evil:
                success = random.random() > 0.7
            else:
                success = True
            return {"action_type": "quest_vote", "payload": {"success": success}}

        if state.phase == Phase.assassination and player.role == Role.assassin:
            # Defer to human evil teammates if present
            if self._has_human_evil_player(state):
                return {"action_type": "chat", "payload": {"message": "pass"}}
            candidates = [p.id for p in state.players if p.id != player.id]
            return {"action_type": "assassinate", "payload": {"target_id": random.choice(candidates)}}

        if state.phase == Phase.lady_of_lake and state.lady_holder_id == player.id:
            candidates = [p.id for p in state.players if p.id != player.id]
            return {"action_type": "lady_peek", "payload": {"target_id": random.choice(candidates)}}

        return {"action_type": "chat", "payload": {"message": "pass"}}

    @staticmethod
    def _evil_ids(state: GameState) -> List[str]:
        return [p.id for p in state.players if p.role and alignment_for(p.role) == Alignment.evil]

    @staticmethod
    def _has_human_evil_player(state: GameState) -> bool:
        """Check if there's at least one human player on the evil team."""
        for p in state.players:
            if not p.is_bot and p.role and alignment_for(p.role) == Alignment.evil:
                return True
        return False
