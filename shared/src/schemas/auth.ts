import { z } from 'zod'

export const loginInput = z.object({ email: z.string().trim().email(), password: z.string().min(1) })
export const changePasswordInput = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10, 'At least 10 characters'),
})
