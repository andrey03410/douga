"use server";

import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn } from "@/auth";
import { normalizeEmail, registerAccount } from "@/server/accounts";

const schema = z.object({
  email: z.string().trim().email("Введите корректный email"),
  password: z.string().min(6, "Пароль минимум 6 символов"),
});

export type AuthState = { error?: string } | undefined;

export async function loginAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  try {
    await signIn("credentials", { email, password, redirectTo: "/projects" });
  } catch (error) {
    if (error instanceof AuthError) return { error: "Неверный email или пароль" };
    throw error; // redirect on success
  }
  return undefined;
}

export async function registerAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Некорректные данные" };
  }
  const email = normalizeEmail(parsed.data.email);
  const { password } = parsed.data;

  try {
    await registerAccount(email, password);
  } catch (error) {
    if ((error as Error).message === "EMAIL_TAKEN") {
      return { error: "Пользователь с таким email уже существует" };
    }
    throw error;
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/projects" });
  } catch (error) {
    if (error instanceof AuthError) return { error: "Не удалось войти после регистрации" };
    throw error;
  }
  return undefined;
}
