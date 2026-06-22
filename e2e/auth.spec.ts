import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("login page renders", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "MyBudget" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Hasło")).toBeVisible();
    await expect(page.getByRole("button", { name: "Zaloguj się" })).toBeVisible();
  });

  test("register page renders", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Rejestracja" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("redirects unauthenticated users to login", async ({ page }) => {
    await page.goto("/budget");
    await expect(page).toHaveURL(/\/login/);
  });
});
