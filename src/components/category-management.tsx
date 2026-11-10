"use client";

import { useActionState, useEffect, useRef } from "react";

import { saveCategory, type CategoryActionState } from "@/app/settings/actions";

const initialState: CategoryActionState = { status: "idle", message: "" };

function CategoryForm({ category }: { category?: { id: string; name: string } }) {
  const [state, action, pending] = useActionState(saveCategory, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!category && state.status === "success") formRef.current?.reset();
  }, [category, state]);

  return (
    <form action={action} className="store-details-form" ref={formRef}>
      {category && <input type="hidden" name="categoryId" value={category.id} />}
      <label>{category ? `Rename ${category.name}` : "Category name"}
        <input name="name" defaultValue={category?.name ?? ""} required maxLength={80} />
      </label>
      <button className={category ? "button-quiet" : "button-primary"} type="submit" disabled={pending}>
        {pending ? "Saving..." : category ? "Save category" : "Add category"}
      </button>
      {state.message && <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
    </form>
  );
}

export function CategoryManagement({ categories }: { categories: Array<{ id: string; name: string }> }) {
  return (
    <section id="categories" className="data-panel store-directory-panel">
      <div className="panel-title-row"><div><h2>Item categories</h2><p>Add or rename categories for your product catalog. Renaming updates the label on existing products.</p></div><span className="table-count">{categories.length} categories</span></div>
      <CategoryForm />
      <div className="store-directory">
        {categories.map((category) => <article className="store-card" key={category.id}><CategoryForm category={category} /></article>)}
      </div>
      {categories.length === 0 && <p className="report-empty">No categories yet. Products can still be saved as uncategorized.</p>}
    </section>
  );
}
