import { PageTransition } from "@/components/PageTransition";
import { PortfolioScreen } from "@/components/portfolio/PortfolioScreen";

export const metadata = { title: "Portfolio · Contour" };

export default function Page() {
  return (
    <PageTransition>
      <PortfolioScreen />
    </PageTransition>
  );
}
