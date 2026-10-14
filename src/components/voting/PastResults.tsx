"use client";
import { useRouter } from "next/navigation";
import type { ElectionResults as Results } from "@/lib/voting/results";
import ElectionResults from "./ElectionResults";

// The results page of a finished delib. Back returns to the list of past delibs.
export default function PastResults({ results }: { results: Results }) {
  const router = useRouter();
  return <ElectionResults results={results} backLabel="History" onBack={() => router.push("/dashboard/delibs/history")}/>;
}
