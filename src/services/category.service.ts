import { api } from "./api";

export interface Category {
    id: string;
    name: string;
    sub_categories: string[];
    is_active?: boolean;
}

export const categoryService = {
    async getCategories(): Promise<Category[]> {
        const { data } = await api.get<{ categories: Category[] }>("/api/v2/categories/public");
        return data.categories;
    }
};
