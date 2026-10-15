import FormEditor from "@/components/dashboard/FormEditor";
import NoYear from "@/components/dashboard/NoYear";
import { currentYear } from "@/lib/membership/store";

export default async function FormEditorPage() {
  const config = await currentYear();
  if (!config) return <NoYear />;
  return (
    <FormEditor
      year={config.year}
      form={config.form}
      pay={{ price: config.prices.new, venmo: config.venmo, zelle: !!config.zelle, cash: config.cashAllowed }}
    />
  );
}
