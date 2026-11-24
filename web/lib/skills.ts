import type { Skill } from "./wire";

export const INDUSTRIES: Record<string, string> = {
  ecommerce: "E-commerce and print on demand", finance: "Finance and insurance", healthcare: "Healthcare",
  legal: "Legal and professional services", manufacturing: "Manufacturing and logistics", "public-sector": "Public sector and utilities", software: "Software teams",
};
export const CATEGORIES: Record<string, string> = {
  analytics: "Analytics", automation: "Automation", content: "Content", "customer-support": "Support", data: "Data", devops: "DevOps", design: "Design", documentation: "Documentation", engineering: "Engineering", finance: "Finance", legal: "Legal", marketing: "Marketing", operations: "Operations", product: "Product", qa: "Quality assurance", research: "Research", sales: "Sales", security: "Security",
};
export interface GallerySkill { key: string; industry: string; name: string; description: string; category: string; installed: boolean; installed_id: string | null; content?: string; files?: string[] }
export interface SkillGalleryData { industries: { id: string; skills: GallerySkill[] }[]; revision: string }
export function filterSkills(skills: Skill[], query: string, categories: string[], usage: string, sort: string): Skill[] {
  const needle = query.trim().toLocaleLowerCase();
  return skills.filter((skill) => (!needle || `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(needle)) && (!categories.length || categories.includes(skill.category ?? "")) && (!usage || (usage === "used" ? !!skill.used_by?.length : !skill.used_by?.length)))
    .sort((a, b) => sort === "usage" ? (b.used_by?.length ?? 0) - (a.used_by?.length ?? 0) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
}
