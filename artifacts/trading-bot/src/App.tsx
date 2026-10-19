import { Switch, Route, Router as WouterRouter } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BotProvider } from "@/hooks/useBot";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import AuthScreen, { ForcePasswordChange, HeldScreen } from "@/pages/auth";
import Admin from "@/pages/admin";
import Layout from "@/pages/layout";
import Dashboard from "@/pages/dashboard";
import Signals from "@/pages/signals";
import LearningPage from "@/pages/learning";
import History from "@/pages/history";
import Settings from "@/pages/settings";
import NotFound from "@/pages/not-found";

function Learning() {
  const { user } = useAuth();
  return user?.isAdmin ? <LearningPage /> : <NotFound />;
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/signals" component={Signals} />
        <Route path="/learning" component={Learning} />
        <Route path="/history" component={History} />
        <Route path="/settings" component={Settings} />
        <Route path="/admin" component={Admin} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function Gate() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-background" />;
  if (!user) return <AuthScreen />;
  if (user.mustChangePassword) return <ForcePasswordChange />;
  if (user.held && !user.isAdmin) return <HeldScreen />;
  return (
    // keyed by user so switching accounts starts from a clean state
    <BotProvider key={user.id}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Router />
      </WouterRouter>
    </BotProvider>
  );
}

function App() {
  return (
    <TooltipProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
