import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import type { GenericObject } from 'vee-validate'
import { nextTick, ref } from 'vue'
import type { z } from 'zod'
import { ApiError } from '~/api/http'

/** vee-validate + zod. Server errors with `field` land on the field, all others in `formError` (alert above the form). */
export function useZodForm<S extends z.ZodType>(schema: S, initialValues: z.input<S>) {
  const form = useForm<z.input<S> & GenericObject, z.output<S> & GenericObject>({ validationSchema: toTypedSchema(schema as never) as never, initialValues: initialValues as never })
  const formError = ref('')
  const busy = ref(false)
  const focusFirst = () => nextTick(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())

  function submit(fn: (values: z.output<S>) => Promise<void>, fields: string[] = []) {
    return form.handleSubmit(async (values) => {
      formError.value = ''
      busy.value = true
      try { await fn(values as z.output<S>) } catch (e) {
        if (e instanceof ApiError) {
          if (e.field && fields.includes(e.field)) { form.setFieldError(e.field as never, e.message); focusFirst() } else formError.value = e.message
        } else formError.value = 'Unerwarteter Fehler.'
      } finally { busy.value = false }
    }, focusFirst)
  }
  return { form, formError, busy, submit }
}
