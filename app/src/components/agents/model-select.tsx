import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type ModelOption,
  modelCatalogQueryOptions,
} from "@/lib/agents/queries";

/**
 * The select's own value for "use the deployment's model". Base UI treats an empty string as
 * "nothing chosen", so the stored empty string is mapped to this on the way in and back on the way
 * out; nothing outside this file sees it.
 */
const AUTO = "__auto__";

/**
 * Which model a Bot runs on: Auto, or one model it is forced onto.
 *
 * The list comes from the server (`GET /api/agents/models`), which reads OpenCode Zen's catalogue
 * with the deployment's key, so the browser never holds the key. Models are grouped by provider.
 * A Bot already set to something the list no longer carries keeps showing it, rather than snapping
 * to Auto and looking as though the choice had been lost.
 *
 * Renders nothing until the list has loaded, and nothing when there is nothing to choose between,
 * so a deployment with no Zen key and no other model key sees no new control at all.
 */
export function ModelSelect({
  value,
  onChange,
  disabled,
  id,
  className,
}: {
  /** `provider/model`, or empty for Auto. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const { data: catalog } = useQuery(modelCatalogQueryOptions());
  if (!catalog || (catalog.options.length === 0 && !value)) return null;

  const options: ModelOption[] = [...catalog.options];
  if (value && !options.some((option) => option.value === value)) {
    options.unshift({
      value,
      label: value.slice(value.indexOf("/") + 1),
      provider: value.slice(0, value.indexOf("/")),
      providerLabel: value.slice(0, value.indexOf("/")),
    });
  }
  const groups = new Map<string, { label: string; options: ModelOption[] }>();
  for (const option of options) {
    const group = groups.get(option.provider) ?? {
      label: option.providerLabel,
      options: [],
    };
    group.options.push(option);
    groups.set(option.provider, group);
  }
  const labels: Record<string, string> = { [AUTO]: catalog.auto.label };
  for (const option of options) {
    labels[option.value] = option.label;
  }

  return (
    <Select
      disabled={disabled}
      items={labels}
      onValueChange={(next) =>
        onChange(next === AUTO || next === null ? "" : next)
      }
      value={value || AUTO}
    >
      <SelectTrigger className={className} id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTO}>{catalog.auto.label}</SelectItem>
        {[...groups.entries()].map(([provider, group]) => (
          <SelectGroup key={provider}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
