import { Suspense } from "react";
import { PageTransition } from "@/components/PageTransition";
import { PaperPositionScreen } from "@/components/portfolio/PaperPositionScreen";

export const metadata = { title: "Position · Contour" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageTransition>
      {/* useSearchParams (the "just opened" notice) needs a Suspense boundary. */}
      <Suspense>
        <PaperPositionScreen id={id} />
      </Suspense>
    </PageTransition>
  );
}
