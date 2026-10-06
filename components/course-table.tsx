"use client"

import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ChevronsUpDownIcon,
  LibraryIcon,
  ListFilterIcon,
  SearchIcon,
} from "lucide-react"
import {
  columnFilteringFeature,
  constructFilterFn,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { COURSE_TIMELINES, type Course } from "@/lib/types"

const PAGE_SIZES = [10, 25, 50]

/**
 * The selected values are the filter and each row holds a single string, which
 * is the mirror image of what the built-in array filters expect. `autoRemove`
 * clears the filter once nothing is selected.
 */
const filterFn_isOneOf = constructFilterFn({
  filter: (dataValue: string | undefined, filterValue: string[]) =>
    dataValue !== undefined && filterValue.includes(dataValue),
  autoRemove: (filterValue: string[] | undefined) => !filterValue?.length,
})

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  filterFns: {
    includesString: filterFn_includesString,
    isOneOf: filterFn_isOneOf,
  },
  sortFns: { text: sortFn_text },
})

const helper = createColumnHelper<typeof features, Course>()

const columns = helper.columns([
  helper.accessor("shortname", {
    header: "Code",
    sortFn: "text",
    cell: (info) => (
      <span className="font-mono text-xs text-muted-foreground">
        {info.getValue()}
      </span>
    ),
  }),
  helper.accessor("fullname", {
    header: "Course",
    sortFn: "text",
    cell: (info) => <span className="font-medium">{info.getValue()}</span>,
  }),
  helper.accessor("category", {
    header: "Category",
    sortFn: "text",
    filterFn: "isOneOf",
    enableGlobalFilter: false,
    cell: (info) => info.getValue() || "—",
  }),
  helper.accessor("timeline", {
    header: "Status",
    sortFn: "text",
    filterFn: "isOneOf",
    enableGlobalFilter: false,
    cell: (info) => {
      const value = info.getValue()
      return (
        <Badge variant={value === "In progress" ? "default" : "outline"}>
          {value}
        </Badge>
      )
    },
  }),
])

/**
 * Secondary columns give way first, leaving the name and the status — the two
 * that decide what the user does next — at every width. The shadcn Table still
 * scrolls horizontally as a last resort.
 */
const COLUMN_CLASS: Record<string, string> = {
  shortname: "hidden @md/main:table-cell",
  category: "hidden @2xl/main:table-cell",
}

function FacetFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  if (options.length < 2) return null

  function toggle(option: string, checked: boolean) {
    const next = checked
      ? [...selected, option]
      : selected.filter((value) => value !== option)
    onChange(next)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm">
            <ListFilterIcon data-icon="inline-start" />
            {label}
            {selected.length > 0 ? (
              <Badge variant="secondary">{selected.length}</Badge>
            ) : null}
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option}
              checked={selected.includes(option)}
              onCheckedChange={(checked) => toggle(option, checked)}
              closeOnClick={false}
            >
              {option}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function CourseTable({
  courses,
  loading,
  onSelect,
}: {
  courses: Course[]
  loading: boolean
  onSelect: (course: Course) => void
}) {
  const categories = React.useMemo(() => {
    const unique = new Set<string>()
    for (const course of courses) if (course.category) unique.add(course.category)
    return [...unique].sort((a, b) => a.localeCompare(b))
  }, [courses])

  // Only the classifications actually present, in Moodle's own order.
  const timelines = React.useMemo(
    () =>
      COURSE_TIMELINES.filter((value) =>
        courses.some((course) => course.timeline === value)
      ),
    [courses]
  )

  const table = useTable({
    features,
    columns,
    data: courses,
    getRowId: (course) => String(course.id),
    globalFilterFn: "includesString",
    initialState: { pagination: { pageIndex: 0, pageSize: PAGE_SIZES[0] } },
  })

  const { globalFilter, columnFilters, pagination } = table.state
  const pageRows = table.getRowModel().rows
  // getRowCount() is the pre-pagination total, so it reflects the filters.
  const matched = table.getRowCount()
  const filtersApplied = Boolean(globalFilter) || columnFilters.length > 0

  function filterValueOf(columnId: string): string[] {
    return (table.getColumn(columnId)?.getFilterValue() as string[]) ?? []
  }

  function setFilterValueOf(columnId: string, next: string[]) {
    table.getColumn(columnId)?.setFilterValue(next.length > 0 ? next : undefined)
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-full max-w-sm rounded-3xl" />
        <div className="rounded-lg border">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="m-3 h-9 rounded-md" />
          ))}
        </div>
      </div>
    )
  }

  if (courses.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LibraryIcon />
          </EmptyMedia>
          <EmptyTitle>No courses</EmptyTitle>
          <EmptyDescription>
            Nothing came back from Moodle for this account. Check the connection
            settings in the sidebar.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={globalFilter ?? ""}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            placeholder="Search courses..."
            aria-label="Search courses"
            className="pl-9"
          />
        </div>

        <FacetFilter
          label="Category"
          options={categories}
          selected={filterValueOf("category")}
          onChange={(next) => setFilterValueOf("category", next)}
        />
        <FacetFilter
          label="Status"
          options={[...timelines]}
          selected={filterValueOf("timeline")}
          onChange={(next) => setFilterValueOf("timeline", next)}
        />

        {filtersApplied ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              table.setGlobalFilter("")
              table.resetColumnFilters()
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={COLUMN_CLASS[header.column.id]}
                    aria-sort={
                      header.column.getIsSorted() === "asc"
                        ? "ascending"
                        : header.column.getIsSorted() === "desc"
                          ? "descending"
                          : undefined
                    }
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="-mx-2 flex items-center gap-1.5 rounded-md px-2 py-1 hover:text-foreground/70 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
                      >
                        <table.FlexRender header={header} />
                        {header.column.getIsSorted() === "asc" ? (
                          <ArrowUpIcon className="size-3.5" />
                        ) : header.column.getIsSorted() === "desc" ? (
                          <ArrowDownIcon className="size-3.5" />
                        ) : (
                          <ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
                        )}
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No courses match the current search or filters.
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((row) => (
                <TableRow
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(row.original)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      onSelect(row.original)
                    }
                  }}
                  className="cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  {row.getAllCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={COLUMN_CLASS[cell.column.id]}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {filtersApplied ? `${matched} of ${courses.length}` : courses.length}{" "}
          {courses.length === 1 ? "course" : "courses"}
        </p>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Rows</span>
            <Select
              value={String(pagination.pageSize)}
              onValueChange={(value) => table.setPageSize(Number(value))}
            >
              <SelectTrigger size="sm" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <span className="text-sm text-muted-foreground">
            Page {pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
          </span>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="First page"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.firstPage()}
            >
              <ChevronsLeftIcon />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Previous page"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Next page"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              <ChevronRightIcon />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Last page"
              disabled={!table.getCanNextPage()}
              onClick={() => table.lastPage()}
            >
              <ChevronsRightIcon />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
