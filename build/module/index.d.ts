import { DocumentData, DocumentReference, SetOptions, DocumentSnapshot, PartialWithFieldValue } from "firebase/firestore";
import { Observable } from "rxjs";
export declare function docExists<T>(ref: DocumentReference<T>): Promise<boolean>;
export declare function setWithCounter<T>(ref: DocumentReference<T>, data: PartialWithFieldValue<T>, setOptions?: SetOptions, opts?: {
    paths?: {
        [col: string]: string;
    };
    dates?: boolean;
}): Promise<void>;
export declare function deleteWithCounter<T>(ref: DocumentReference<T>, opts?: {
    paths?: {
        [col: string]: string;
    };
}): Promise<void>;
export declare function expandRef<T>(obs: Observable<T>, fields?: any[]): Observable<T>;
export declare function expandRefs<T>(obs: Observable<T[]>, fields?: any[]): Observable<T[]>;
/**
 *
 * @param param: {
 *  ref - document ref
 *  data - document data
 *  del - boolean - delete past index
 *  useSoundex - index with soundex
 *  docObj - the document object in case of ssr,
 *  soundex_func - change out soundex function for other languages
 * }
 * @returns
 */
export declare function searchIndex<T>({ ref, data, fields, del, useSoundex, docObj, soundex_func }: {
    ref: DocumentReference<T>;
    data: any;
    fields: string[];
    del: boolean;
    useSoundex: boolean;
    docObj: Document;
    soundex_func: (s: string) => string;
}): Promise<void>;
export declare function createIndex(doc: Document, html: string, n: number): string[];
export declare function soundex(s: string): string;
export declare function snapToData<T = DocumentData>(snapshot: DocumentSnapshot<T>, options?: {
    idField?: string;
}): T | undefined;
export declare function docData<T = DocumentData>(ref: DocumentReference<T>, options?: {
    idField?: string;
}): Observable<T>;