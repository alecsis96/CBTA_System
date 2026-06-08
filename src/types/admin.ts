import type { AppRole } from './domain'

export type DepartmentSummary = {
  id: string
  code: string
  name: string
  description: string | null
  isActive: boolean
}

export type UserSummary = {
  id: string
  username: string
  displayName: string
  role: AppRole
  departmentId: string | null
  departmentName: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type UserCreateInput = {
  username: string
  displayName: string
  role: AppRole
  departmentId?: string | null
  isActive: boolean
  password: string
}

export type UserUpdateInput = {
  displayName: string
  role: AppRole
  departmentId?: string | null
  isActive: boolean
}

export type UserResetPasswordInput = {
  password: string
}
