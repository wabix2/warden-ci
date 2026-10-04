export interface AuthorizationDecisionLog {
  requestId?: string;
  principalId?: string;
  tenantId?: string;
  resourceType: string;
  resourceId?: string;
  allowed: boolean;
  reason: string;
}

export function logAuthorizationDecision(decision: AuthorizationDecisionLog): void {
  console.info(JSON.stringify({ event: "authorization_decision", ...decision }));
}
