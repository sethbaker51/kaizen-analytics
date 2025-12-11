import Header from "@/components/Header";
import ConnectionTestCard from "@/components/ConnectionTestCard";
import SalesWidget from "@/components/SalesWidget";

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="px-4 py-8 md:px-8 md:py-12">
        <div className="max-w-4xl mx-auto space-y-8">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-page-title">Dashboard</h1>
            <p className="text-muted-foreground mt-1">
              Connect to Amazon SP-API and monitor your seller analytics
            </p>
          </div>

          <SalesWidget />

          <ConnectionTestCard />
        </div>
      </main>
    </div>
  );
}
