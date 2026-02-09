export interface UniversalSection {
    id: string;
    title: string;
    description: string;
    defaultPrompt: string;
    subItems: string[];
}

export interface SectionCustomization {
    sectionId: string;
    customPrompt?: string;
    isDeleted: boolean;
}
