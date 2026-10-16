import { Button } from '../components/Button.jsx';
import { EmptyState } from '../components/Feedback.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

export function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <div className="page">
      <EmptyState title="This page doesn't exist" action={<Button to="/" variant="primary">Go to booking</Button>}>
        The link may be out of date.
      </EmptyState>
    </div>
  );
}
