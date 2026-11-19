import { PageTransition } from "@/components/PageTransition";
import { PositionScreen } from "@/components/position/PositionScreen";

export default async function Page({ params }: { params: Promise<{ pubkey: string }> }) {
  const { pubkey } = await params;
  return (
    <PageTransition>
      <PositionScreen pubkey={pubkey} />
    </PageTransition>
  );
}
