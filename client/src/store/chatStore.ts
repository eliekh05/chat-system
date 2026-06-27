import { useReducer, useCallback } from "react";
import type { MessageEnvelope, MessageStatus } from "../types.js";

interface ChatState {
  messages: MessageEnvelope[];
  presenceMap: Map<string, { sessionId: string; userId: string; displayName: string }>;
}

type ChatAction =
  | { type: "MESSAGE_RECEIVE"; message: MessageEnvelope }
  | { type: "MESSAGE_STATUS_UPDATE"; messageId: string; status: MessageStatus }
  | { type: "MESSAGE_OPTIMISTIC"; message: MessageEnvelope }
  | { type: "SYNC_HISTORY"; messages: MessageEnvelope[] }
  | { type: "USER_JOIN"; sessionId: string; userId: string; displayName: string }
  | { type: "USER_LEAVE"; sessionId: string };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "MESSAGE_RECEIVE": {
      // If this is a real message replacing an optimistic one, find the optimistic one
      const existingIndex = state.messages.findIndex(
        (m) => m.metadata.optimisticId === action.message.metadata.optimisticId && m.metadata.optimisticId !== ""
      );

      if (existingIndex !== -1) {
        const nextMessages = [...state.messages];
        nextMessages[existingIndex] = action.message;
        return {
          ...state,
          messages: nextMessages.sort((a, b) => a.timestamp - b.timestamp),
        };
      }

      // Avoid duplicates for non-optimistic messages
      if (state.messages.some((m) => m.messageId === action.message.messageId)) {
        return state;
      }
      return {
        ...state,
        messages: [...state.messages, action.message].sort((a, b) => a.timestamp - b.timestamp),
      };
    }

    case "MESSAGE_OPTIMISTIC": {
      return {
        ...state,
        messages: [...state.messages, action.message],
      };
    }

    case "MESSAGE_STATUS_UPDATE": {
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.metadata.optimisticId === action.optimisticId
            ? { ...m, messageId: action.messageId, status: action.status }
            : m.messageId === action.messageId
            ? { ...m, status: action.status }
            : m
        ),
      };
    }

    case "SYNC_HISTORY": {
      const existingIds = new Set(state.messages.map((m) => m.messageId));
      const newMessages = action.messages.filter((m) => !existingIds.has(m.messageId));
      return {
        ...state,
        messages: [...state.messages, ...newMessages].sort((a, b) => a.timestamp - b.timestamp),
      };
    }

    case "USER_JOIN": {
      const next = new Map(state.presenceMap);
      next.set(action.sessionId, { sessionId: action.sessionId, userId: action.userId, displayName: action.displayName });
      return { ...state, presenceMap: next };
    }

    case "USER_LEAVE": {
      const next = new Map(state.presenceMap);
      next.delete(action.sessionId);
      return { ...state, presenceMap: next };
    }

    default:
      return state;
  }
}

export function useChatStore() {
  const [state, dispatch] = useReducer(chatReducer, {
    messages: [],
    presenceMap: new Map(),
  });

  const receiveMessage = useCallback((message: MessageEnvelope) =>
    dispatch({ type: "MESSAGE_RECEIVE", message }), []);

  const addOptimisticMessage = useCallback((message: MessageEnvelope) =>
    dispatch({ type: "MESSAGE_OPTIMISTIC", message }), []);

  const updateMessageStatus = useCallback((messageId: string, status: MessageStatus) =>
    dispatch({ type: "MESSAGE_STATUS_UPDATE", messageId, status }), []);

  const syncHistory = useCallback((messages: MessageEnvelope[]) =>
    dispatch({ type: "SYNC_HISTORY", messages }), []);

  const userJoin = useCallback((sessionId: string, userId: string, displayName: string) =>
    dispatch({ type: "USER_JOIN", sessionId, userId, displayName }), []);

  const userLeave = useCallback((sessionId: string) =>
    dispatch({ type: "USER_LEAVE", sessionId }), []);

  return {
    messages: state.messages,
    presenceMap: state.presenceMap,
    receiveMessage,
    addOptimisticMessage,
    updateMessageStatus,
    syncHistory,
    userJoin,
    userLeave,
  };
}
