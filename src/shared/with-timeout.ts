export const withTimeout = async <TValue>(task: Promise<TValue>, ms: number, label: string): Promise<TValue> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<TValue>((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${ms}ms`))
      }, ms)
      timer.unref()
      task.then(resolve, reject)
    })
  } finally {
    clearTimeout(timer)
  }
}
