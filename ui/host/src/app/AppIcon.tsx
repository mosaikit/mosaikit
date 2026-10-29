// The icon of an app in the shell: the set of the shell (Lucide), named by the manifest of the plugin
// (`icon = "notebook-pen"`), so the bar has a single style. Only the names below are drawn (a manifest
// cannot load anything else); an unknown name falls back to the icon of the official plugins of an
// older server, then to the puzzle piece.

import {
  Archive, BadgeCheck, BarChart3, Bell, Book, BookOpen, BookUser, Bot, Briefcase, Building2, Calendar, Camera,
  ChartPie, ClipboardList, Clock, Cloud, Code, Database, FileText, Files, Folder, Gauge, Globe, Image, Inbox,
  Kanban, Landmark, Layers, LayoutDashboard, LayoutGrid, Link, List, ListChecks, Mail, Map, MapPin, MessageSquare,
  NotebookPen, Package, PenTool, Puzzle, Receipt, Route, Server, Settings, Share2, ShieldCheck, ShoppingCart,
  SquareCheckBig, Star, Table, Tag, Truck, Users, Wallet, Wrench, type LucideIcon,
} from 'lucide-react'

/** The names a manifest may use. */
const ICONS: Record<string, LucideIcon> = {
  archive: Archive,
  'badge-check': BadgeCheck,
  'bar-chart-3': BarChart3,
  bell: Bell,
  book: Book,
  'book-open': BookOpen,
  'book-user': BookUser,
  bot: Bot,
  briefcase: Briefcase,
  'building-2': Building2,
  calendar: Calendar,
  camera: Camera,
  'chart-pie': ChartPie,
  'clipboard-list': ClipboardList,
  clock: Clock,
  cloud: Cloud,
  code: Code,
  database: Database,
  'file-text': FileText,
  files: Files,
  folder: Folder,
  gauge: Gauge,
  globe: Globe,
  grid: LayoutGrid,
  image: Image,
  inbox: Inbox,
  kanban: Kanban,
  landmark: Landmark,
  layers: Layers,
  'layout-dashboard': LayoutDashboard,
  link: Link,
  list: List,
  'list-checks': ListChecks,
  mail: Mail,
  map: Map,
  'map-pin': MapPin,
  'message-square': MessageSquare,
  'notebook-pen': NotebookPen,
  package: Package,
  'pen-tool': PenTool,
  puzzle: Puzzle,
  receipt: Receipt,
  route: Route,
  server: Server,
  settings: Settings,
  'share-2': Share2,
  'shield-check': ShieldCheck,
  'shopping-cart': ShoppingCart,
  'square-check-big': SquareCheckBig,
  star: Star,
  table: Table,
  tag: Tag,
  truck: Truck,
  users: Users,
  wallet: Wallet,
  wrench: Wrench,
}

/** The official plugins on a server that does not send the name of the icon yet. */
const BY_APP: Record<string, LucideIcon> = {
  tasks: SquareCheckBig,
  contacts: BookUser,
  files: Folder,
  maps: Map,
  notes: NotebookPen,
  'static-site': LayoutGrid,
}

export default function AppIcon({ id, name, className }: { id: string; name?: string | null; className?: string }) {
  const Icon = (name ? ICONS[name] : undefined) ?? BY_APP[id.split('.').pop() ?? ''] ?? Puzzle
  return <Icon className={className} aria-hidden="true" />
}
