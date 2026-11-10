import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ToastProvider } from "./components/ui";
import { RecipeListPage } from "./pages/RecipeListPage";
import { RecipeDetailPage } from "./pages/RecipeDetailPage";
import { RecipeEditorPage } from "./pages/RecipeEditorPage";
import { CookingPage } from "./pages/CookingPage";
import { PrintPage } from "./pages/PrintPage";
import { CapturePage } from "./pages/CapturePage";
import { ImportReviewPage } from "./pages/ImportReviewPage";
import { SearchPage } from "./pages/SearchPage";
import { ShoppingPage } from "./pages/ShoppingPage";
import { FriendsPage } from "./pages/FriendsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AdminPage } from "./pages/AdminPage";
import { InvitePage } from "./pages/InvitePage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => {
        const code = (error as { code?: string } | null)?.code;
        if (code === "unauthenticated" || code === "not_member" || code === "forbidden") return false;
        return count < 2;
      },
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<RecipeListPage scope="mine" />} />
              <Route path="entdecken" element={<RecipeListPage scope="all" />} />
              <Route path="rezept/:id" element={<RecipeDetailPage />} />
              <Route path="r/:id" element={<RecipeDetailPage />} />
              <Route path="rezept/:id/bearbeiten" element={<RecipeEditorPage />} />
              <Route path="neu" element={<RecipeEditorPage />} />
              <Route path="erfassen" element={<CapturePage />} />
              <Route path="import/:id" element={<ImportReviewPage />} />
              <Route path="suche" element={<SearchPage />} />
              <Route path="einkauf" element={<ShoppingPage />} />
              <Route path="freunde" element={<FriendsPage />} />
              <Route path="profil/:id" element={<ProfilePage />} />
              <Route path="benachrichtigungen" element={<NotificationsPage />} />
              <Route path="einstellungen" element={<SettingsPage />} />
              <Route path="verwaltung" element={<AdminPage />} />
              <Route path="f/:token" element={<InvitePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
            <Route path="/rezept/:id/kochen" element={<CookingPage />} />
            <Route path="/rezept/:id/drucken" element={<PrintPage />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
