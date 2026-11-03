/** Editable document data is independent of geometry, paper format and viewport state. */
export const titleBlockDefaults = {
  title: '',
  number: '',
  material: '',
  organization: '',
  author: '',
  revision: '',
  tolerance: '',
  notes: '',
  mass: '',
  litera: '',
  sheetNumber: '',
  sheetCount: '',
  date: '',
  signature: '',
  checkedBy: '',
  checkedDate: '',
  checkedSignature: '',
  technicalControl: '',
  technicalControlDate: '',
  technicalControlSignature: '',
  standardControl: '',
  standardControlDate: '',
  standardControlSignature: '',
  approvedBy: '',
  approvedDate: '',
  approvedSignature: '',
  changeSheet: '',
  changeDocument: '',
  changeSignature: '',
  changeDate: '',
  inventoryNumber: '',
  inventorySignature: '',
  inventoryDate: '',
  replacedInventoryNumber: '',
  duplicateInventoryNumber: '',
  duplicateSignature: '',
  duplicateDate: '',
  copiedBy: '',
};
export type TitleBlockKey = keyof typeof titleBlockDefaults;
export const titleBlockKeys = Object.keys(titleBlockDefaults) as TitleBlockKey[];

/** XML and project text cannot contain non-printing C0 control characters. */
export const cleanTitleBlockText = (value: string): string =>
  value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
