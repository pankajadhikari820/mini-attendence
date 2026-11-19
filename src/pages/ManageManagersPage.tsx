import React from 'react';
import { PeopleManagerView } from '../components/PeopleManagerView';

export const ManageManagersPage: React.FC = () => {
  return <PeopleManagerView targetRole="manager" />;
};
