// Building blocks of the lists (mockup: the filter column, the selection bar of the header): the filter
// column with groups of options and counts, the bar of the selection and the page that holds them.

import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { t } from "./i18n.ts";
import { FillBody, FillPage, PageHeader } from "./kit.tsx";

/** Where the search of the filter column goes: the header of the page, just left of its actions. */
const SearchSlot = createContext<HTMLElement | null>(null);

/** One group of the filter column: a heading and the options (one chosen), each with its count. */
export interface FacetGroup {
  id: string;
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: { id: string; label: string; count?: number }[];
}

/** The filter column of the lists, as in the mockup: «Filters» with Reset, the search, then the groups.
 *  It stays in sight while the list scrolls; on the phone it sits above the list. */
export function FilterColumn({
  search,
  onSearch,
  searchLabel,
  groups,
  onReset,
}: {
  search?: string;
  onSearch?: (v: string) => void;
  searchLabel?: string;
  groups: FacetGroup[];
  onReset?: () => void;
}) {
  const slot = useContext(SearchSlot);
  const box = onSearch && (
    <Input
      type="search"
      placeholder={searchLabel}
      aria-label={searchLabel}
      className={
        slot ? "h-9 w-56 max-w-full bg-background" : "mb-3 bg-background"
      }
      value={search ?? ""}
      onChange={(e) => onSearch(e.target.value)}
    />
  );
  return (
    <aside
      aria-label={t("Filters")}
      className="msk-facets msk-hoverscroll w-60 shrink-0 overflow-y-auto border-r bg-pane p-3 max-[760px]:max-h-[45%] max-[760px]:w-auto max-[760px]:border-r-0 max-[760px]:border-b"
    >
      <div className="mb-2 flex items-center justify-between">
        <b className="text-sm">{t("Filters")}</b>
        {onReset && (
          <button
            type="button"
            className="text-xs text-primary-strong hover:underline"
            onClick={onReset}
          >
            {t("Reset")}
          </button>
        )}
      </div>
      {slot ? createPortal(box, slot) : box}
      {groups.map((g) => (
        <div key={g.id} role="radiogroup" aria-label={g.label} className="mb-3">
          <div className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {g.label}
          </div>
          {g.options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={o.id === g.value}
              onClick={() => g.onChange(o.id)}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                o.id === g.value &&
                  "bg-primary/10 font-medium text-primary-strong hover:bg-primary/10",
              )}
            >
              <span className="flex-1 truncate">{o.label}</span>
              {o.count != null && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {o.count}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </aside>
  );
}

/** The selection bar of the header of a list (mockup): the box «select all» with the count and, only
 *  with a selection, the actions on it. */
export function BulkBar({
  selected,
  total,
  all,
  onAll,
  actions,
}: {
  selected: number;
  total: number;
  all: boolean;
  onAll: (on: boolean) => void;
  actions?: ReactNode;
}) {
  return (
    <div
      className="msk-bulk flex min-w-0 flex-wrap items-center gap-2"
      role="group"
      aria-label={t("Actions on the selection")}
    >
      {total > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            aria-label={t("Select all")}
            checked={all ? true : selected ? "indeterminate" : false}
            onCheckedChange={(v) => onAll(!!v)}
          />
          {selected > 0 && (
            <span className="font-medium tabular-nums">
              {t("{count} selected", { count: selected })}
            </span>
          )}
        </label>
      )}
      {selected > 0 && actions}
    </div>
  );
}

function storedHidden(): boolean {
  try {
    return localStorage.getItem("msk_filters_hidden") === "1";
  } catch {
    return false;
  }
}

/** A list page: the filter column at the left (a button of the header hides it) and the list at the
 *  right. Nothing scrolls but the list: the header (with the selection bar and the actions), the filters and the header
 *  row of the table stay where they are, and the foot of the list loads more as it comes into view. */
export function ListPage({
  title,
  section,
  sub,
  bar,
  actions,
  more,
  filters,
  children,
}: {
  title: string;
  section?: string;
  sub?: ReactNode;
  bar?: ReactNode;
  actions?: ReactNode;
  more?: ReactNode;
  filters: ReactNode;
  children: ReactNode;
}) {
  const [hidden, setHidden] = useState(storedHidden);
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const narrow = () => window.matchMedia("(max-width: 760px)").matches;
  const toggle = () => {
    // wide: hide or show the column; narrow: open it above the list
    if (narrow()) return setOpen(!open);
    const next = !hidden;
    setHidden(next);
    try {
      localStorage.setItem("msk_filters_hidden", next ? "1" : "0");
    } catch {
      /* no storage: it is only a convenience */
    }
  };
  return (
    <SearchSlot.Provider value={slot}>
      <FillPage>
        <PageHeader
          title={title}
          section={section}
          sub={sub}
          bar={bar}
          actions={actions}
          more={more}
          filter={<span ref={setSlot} className="contents" />}
          lead={
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("Show or hide the filters")}
              aria-expanded={narrow() ? open : !hidden}
              title={t("Show or hide the filters")}
              onClick={toggle}
            >
              <PanelLeft />
            </Button>
          }
        />
        <div className="msk-list flex min-h-0 flex-1 max-[760px]:flex-col">
          <div
            className={cn(
              "contents",
              hidden && "min-[761px]:[&>aside]:hidden",
              !open && "max-[760px]:[&>aside]:hidden",
            )}
          >
            {filters}
          </div>
          <FillBody>
            <div className="grid content-start gap-3 p-6 max-[620px]:p-4">
              {children}
            </div>
          </FillBody>
        </div>
      </FillPage>
    </SearchSlot.Provider>
  );
}
