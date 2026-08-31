/**
 * In-memory member store.
 * In production, replace with Auth0 Management API calls.
 */

export type MemberStatus = 'active' | 'inactive' | 'invited'
export type MemberRole = 'admin' | 'editor' | 'viewer'

export interface Member {
  id: string
  name: string
  email: string
  role: MemberRole
  status: MemberStatus
  joinedAt: string   // ISO date string
}

const store = new Map<string, Member>([
  ['mbr-001', {
    id: 'mbr-001',
    name: 'Alice Chen',
    email: 'alice.chen@partner.example',
    role: 'admin',
    status: 'active',
    joinedAt: '2026-01-10',
  }],
  ['mbr-002', {
    id: 'mbr-002',
    name: 'Bob Martinez',
    email: 'bob.martinez@partner.example',
    role: 'editor',
    status: 'active',
    joinedAt: '2026-03-22',
  }],
  ['mbr-003', {
    id: 'mbr-003',
    name: 'Carol Kim',
    email: 'carol.kim@partner.example',
    role: 'viewer',
    status: 'invited',
    joinedAt: '2026-08-01',
  }],
  ['mbr-004', {
    id: 'mbr-004',
    name: 'Dave Okafor',
    email: 'dave.okafor@partner.example',
    role: 'editor',
    status: 'inactive',
    joinedAt: '2025-11-05',
  }],
  ['mbr-005', {
    id: 'mbr-005',
    name: 'Eva Rossi',
    email: 'eva.rossi@partner.example',
    role: 'viewer',
    status: 'active',
    joinedAt: '2026-06-14',
  }],
])

export function listMembers(status?: MemberStatus): Member[] {
  const all = Array.from(store.values())
  return status ? all.filter((m) => m.status === status) : all
}

export function getMember(id: string): Member | undefined {
  return store.get(id)
}

export function addMember(name: string, email: string, role: MemberRole): Member {
  const id = `mbr-${Date.now()}`
  const member: Member = { id, name, email, role, status: 'invited', joinedAt: new Date().toISOString().slice(0, 10) }
  store.set(id, member)
  return member
}

export function updateMemberStatus(id: string, status: MemberStatus): Member | null {
  const member = store.get(id)
  if (!member) return null
  member.status = status
  return member
}
