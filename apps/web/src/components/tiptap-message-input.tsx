"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension } from "@tiptap/core";
import { forwardRef, useImperativeHandle, useEffect, useRef } from "react";

export interface TiptapMessageInputHandle {
  focus: () => void;
  clear: () => void;
  getMarkdown: () => string;
  /** Replace @query text near cursor with replacement string */
  replaceMention: (query: string, replacement: string) => void;
}

interface TiptapMessageInputProps {
  placeholder?: string;
  disabled?: boolean;
  /** Called when user presses Enter on non-empty content */
  onSend: (text: string) => void;
  /** Called on every content change */
  onTextUpdate?: (textBeforeCursor: string, fullText: string) => void;
  /** Intercept keys before Tiptap. Return true to consume (for @mention nav). */
  onKeyDown?: (event: KeyboardEvent) => boolean;
}

function createSendOnEnterExtension(
  onSendRef: React.RefObject<(text: string) => void>
) {
  return Extension.create({
    name: "sendOnEnter",
    addKeyboardShortcuts() {
      return {
        Enter: ({ editor }) => {
          const text = editor.getText({ blockSeparator: "\n" });
          if (!text.trim()) return true;
          onSendRef.current(text);
          editor.commands.clearContent(true);
          return true;
        },
      };
    },
  });
}

const TiptapMessageInput = forwardRef<
  TiptapMessageInputHandle,
  TiptapMessageInputProps
>(function TiptapMessageInput(
  { placeholder, disabled, onSend, onTextUpdate, onKeyDown },
  ref
) {
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        codeBlock: false,
        horizontalRule: false,
        dropcursor: false,
        gapcursor: false,
      }),
      Placeholder.configure({
        placeholder: placeholder || "Write a message...",
      }),
      createSendOnEnterExtension(onSendRef),
    ],
    editorProps: {
      attributes: {
        class: "focus:outline-none",
      },
      handleKeyDown: (_view, event) => {
        if (onKeyDown) {
          const handled = onKeyDown(event);
          if (handled) return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (onTextUpdate) {
        const { from } = ed.state.selection;
        const $from = ed.state.doc.resolve(from);
        const textBeforeCursor = $from.parent.textBetween(
          0,
          $from.parentOffset
        );
        onTextUpdate(textBeforeCursor, ed.getText());
      }
    },
    onSelectionUpdate: ({ editor: ed }) => {
      if (onTextUpdate) {
        const { from } = ed.state.selection;
        const $from = ed.state.doc.resolve(from);
        const textBeforeCursor = $from.parent.textBetween(
          0,
          $from.parentOffset
        );
        onTextUpdate(textBeforeCursor, ed.getText());
      }
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [editor, disabled]);

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus(),
    clear: () => editor?.commands.clearContent(true),
    getMarkdown: () => editor?.getText({ blockSeparator: "\n" }) ?? "",
    replaceMention: (query: string, replacement: string) => {
      if (!editor) return;
      const { from } = editor.state.selection;
      const $from = editor.state.doc.resolve(from);
      const text = $from.parent.textBetween(0, $from.parent.content.size);
      const textBefore = text.slice(0, $from.parentOffset);
      const idx = textBefore.lastIndexOf("@");
      if (idx === -1) return;

      const afterAt = text.slice(idx + 1);
      const currentMention = afterAt.match(/^[^\s@]*/)?.[0] ?? "";
      if (!currentMention.toLowerCase().startsWith(query.toLowerCase())) return;

      const start = $from.start() + idx;
      const end = start + 1 + currentMention.length;
      editor
        .chain()
        .deleteRange({ from: start, to: end })
        .insertContent(replacement)
        .run();
    },
  }));

  return (
    <div className="tiptap-input">
      <EditorContent editor={editor} />
    </div>
  );
});

export default TiptapMessageInput;
