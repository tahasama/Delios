import {
  FolderKanban, Building2, Tags, FileDigit, BadgeCheck, Users, Workflow, ScrollText, Route, ClipboardList, KeyRound, GitBranch, Stamp,
  type LucideIcon,
} from "lucide-react";

/** One icon per Settings card, the same in a project's Settings and the organization's (owner: the same cards). */
export const SETUP_ICON: Record<string, LucideIcon> = {
  "/settings/projects": FolderKanban,
  "/settings/parties": Building2,
  "/settings/config": Tags,
  "/settings/fields": ClipboardList,
  "/settings/numbering": FileDigit,
  "/settings/flow": Route,
  "/settings/workflow-templates": Workflow,
  "/settings/functions": BadgeCheck,
  "/settings/users": Users,
  "/settings/security": KeyRound,
  "/settings/revisions": GitBranch,
  "/settings/stamp": Stamp,
  "/settings/audit": ScrollText,
};
