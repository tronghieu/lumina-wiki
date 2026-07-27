export type SessionIdentityInput = {
  sessionId: string;
  generation: number;
} | null;

export type SessionRequestToken = {
  sessionKey: string;
  requestId: number;
};

export function sessionIdentity(session: SessionIdentityInput): string {
  return session ? `${session.sessionId}:${session.generation}` : 'no-session';
}

export function createSessionRequestGuard() {
  let sessionKey = 'no-session';
  let currentRequestId = 0;

  return {
    setSession(session: SessionIdentityInput): string {
      const nextSessionKey = sessionIdentity(session);
      if (nextSessionKey !== sessionKey) {
        sessionKey = nextSessionKey;
        currentRequestId += 1;
      }
      return sessionKey;
    },
    begin(): SessionRequestToken {
      currentRequestId += 1;
      return { sessionKey, requestId: currentRequestId };
    },
    isCurrent(token: SessionRequestToken): boolean {
      return token.sessionKey === sessionKey && token.requestId === currentRequestId;
    },
  };
}
