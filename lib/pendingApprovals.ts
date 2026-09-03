/**
 * In-memory pending approval store.
 * Holds membership requests from users who want to join an org.
 * In production, replace with Auth0 Management API member enrollment calls.
 */

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface PendingApproval {
  id: string
  userId: string    // requester's Auth0 sub
  userName: string
  userEmail: string
  orgId: string     // org they are requesting to join
  requestedAt: string
  status: ApprovalStatus
}

const store = new Map<string, PendingApproval>([
  ['apr-001', {
    id: 'apr-001',
    userId: 'auth0|pending001',
    userName: 'Frank Nguyen',
    userEmail: 'frank.nguyen@company.example',
    orgId: 'org_YOdWQXlK7kxkWFLo',
    requestedAt: '2026-08-28',
    status: 'pending',
  }],
  ['apr-002', {
    id: 'apr-002',
    userId: 'auth0|pending002',
    userName: 'Grace Li',
    userEmail: 'grace.li@company.example',
    orgId: 'org_YOdWQXlK7kxkWFLo',
    requestedAt: '2026-08-30',
    status: 'pending',
  }],
  ['apr-003', {
    id: 'apr-003',
    userId: 'auth0|pending003',
    userName: 'Henry Park',
    userEmail: 'henry.park@company.example',
    orgId: 'org_YOdWQXlK7kxkWFLo',
    requestedAt: '2026-09-01',
    status: 'pending',
  }],
])

export function listPendingApprovals(orgId: string, statusFilter?: ApprovalStatus): PendingApproval[] {
  return Array.from(store.values()).filter(
    (a) => a.orgId === orgId && (statusFilter ? a.status === statusFilter : true),
  )
}

export function getApproval(id: string): PendingApproval | undefined {
  return store.get(id)
}

export function updateApprovalStatus(id: string, status: ApprovalStatus): PendingApproval | null {
  const approval = store.get(id)
  if (!approval) return null
  approval.status = status
  return approval
}
