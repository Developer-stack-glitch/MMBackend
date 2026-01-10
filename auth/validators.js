import { z } from "zod";

export const registerSchema = z.object({
    name: z.string().min(2).max(120),
    email: z.string().email().max(191),
    password: z.string().min(8).max(128)
});

export const loginSchema = z.object({
    email: z.string().email().max(191),
    password: z.string()
});
