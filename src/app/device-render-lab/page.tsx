import { notFound } from "next/navigation";
import DeviceRenderLab from "./DeviceRenderLab";

/** Native export smoke test. Never expose this page from a production server. */
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <DeviceRenderLab />;
}
