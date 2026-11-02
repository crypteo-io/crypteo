"use client";

export interface EndpointOption {
  id: string;
  url: string;
  label: string | null;
  isActive: boolean;
  isDefault: boolean;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function endpointName(e: EndpointOption): string {
  return e.label ? `${e.label} (${hostOf(e.url)})` : hostOf(e.url);
}

/**
 * Pick where payments send webhooks: the merchant's default endpoint (value
 * "") or one specific endpoint. Shared by API keys and payment links.
 */
export function EndpointSelect({
  id,
  value,
  onChange,
  endpoints,
  disabled,
  className,
  extraOptions,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  endpoints: readonly EndpointOption[];
  disabled?: boolean;
  className?: string;
  /** Appended after the endpoints, e.g. a "custom URL" choice. */
  extraOptions?: React.ReactNode;
}) {
  const fallback = endpoints.find((e) => e.isDefault);
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={className}
    >
      <option value="">
        {fallback
          ? `Default endpoint: ${endpointName(fallback)}${fallback.isActive ? "" : " (paused)"}`
          : "Default endpoint (none set)"}
      </option>
      {endpoints
        .filter((e) => !e.isDefault)
        .map((e) => (
          <option key={e.id} value={e.id}>
            {endpointName(e)}
            {e.isActive ? "" : " (paused)"}
          </option>
        ))}
      {extraOptions}
    </select>
  );
}
